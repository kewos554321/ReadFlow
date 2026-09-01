console.log('[ReadFlow] content script loaded on:', window.location.href);

// ── Inlined: isBlockElement + extractContext ──────────────────────
const BLOCK_TAGS = ['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'TD'];

function isBlockElement(el) {
  return BLOCK_TAGS.includes(el.tagName);
}

function extractContext(win) {
  const selection = win.getSelection();
  const selectedText = selection.toString().trim();
  if (!selectedText || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  let node = range.commonAncestorContainer;
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
  while (node && !isBlockElement(node)) node = node.parentNode;

  const surroundingParagraph = node
    ? (node.innerText || node.textContent || '').trim().slice(0, 500)
    : selectedText;

  return { selectedText, surroundingParagraph };
}

// ── Inlined: renderMarkdown ───────────────────────────────────────
function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)([^*\n]+)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ── State ─────────────────────────────────────────────────────────
let floatingIcon = null;
let tooltip = null;
let pendingContext = null;
let pendingRect = null;

// ── Floating icon ─────────────────────────────────────────────────
function createIcon(rect) {
  removeIcon();
  floatingIcon = document.createElement('div');
  floatingIcon.className = 'readflow-icon';
  floatingIcon.textContent = '📖';
  floatingIcon.title = 'ReadFlow: explain this';

  floatingIcon.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
  floatingIcon.style.top = `${rect.top + window.scrollY - 36}px`;

  floatingIcon.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pendingContext && pendingRect) triggerLookup(pendingContext, pendingRect);
  });

  document.body.appendChild(floatingIcon);
}

function removeIcon() {
  if (floatingIcon) { floatingIcon.remove(); floatingIcon = null; }
}

// ── Tooltip ───────────────────────────────────────────────────────
function showTooltip(rect, html) {
  removeTooltip();
  tooltip = document.createElement('div');
  tooltip.className = 'readflow-tooltip';
  tooltip.innerHTML = html;

  tooltip.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
  tooltip.style.top = `${rect.top + window.scrollY - 44}px`;

  document.body.appendChild(tooltip);
}

function removeTooltip() {
  if (tooltip) { tooltip.remove(); tooltip = null; }
}

// ── Lookup ────────────────────────────────────────────────────────
function triggerLookup(context, rect) {
  removeIcon();
  showTooltip(rect, '<span class="readflow-loading">Loading…</span>');

  chrome.storage.local.get(['apiKey'], ({ apiKey }) => {
    if (!apiKey) {
      showTooltip(rect, '<span class="readflow-error">No API key. Click the ReadFlow icon in the toolbar to add one.</span>');
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: 'lookup',
        selectedText: context.selectedText,
        surroundingParagraph: context.surroundingParagraph,
        apiKey,
      },
      (response) => {
        if (chrome.runtime.lastError || response?.error) {
          const msg = response?.error || chrome.runtime.lastError?.message;
          showTooltip(rect, `<span class="readflow-error">Error: ${msg}</span>`);
          return;
        }
        showTooltip(rect, renderMarkdown(response.result));
      }
    );
  });
}

// ── Event handlers (iframe-aware) ─────────────────────────────────
function makeMouseUpHandler(iframeEl) {
  return function onMouseUp(e) {
    if (e.button !== 0) return;

    setTimeout(() => {
      const win = iframeEl ? iframeEl.contentWindow : window;
      const context = extractContext(win);
      if (!context) { removeIcon(); return; }

      const selection = win.getSelection();
      if (selection.rangeCount === 0) return;
      const selRect = selection.getRangeAt(0).getBoundingClientRect();

      // Offset selection rect by iframe's position in the outer document
      let rect = selRect;
      if (iframeEl) {
        const iframeRect = iframeEl.getBoundingClientRect();
        rect = {
          left: selRect.left + iframeRect.left,
          top: selRect.top + iframeRect.top,
          width: selRect.width,
          right: selRect.right + iframeRect.left,
          bottom: selRect.bottom + iframeRect.top,
        };
      }

      pendingContext = context;
      pendingRect = rect;
      createIcon(rect);
    }, 10);
  };
}

function makeMouseDownHandler() {
  return function onMouseDown(e) {
    if (floatingIcon?.contains(e.target) || tooltip?.contains(e.target)) return;
    removeIcon();
    removeTooltip();
  };
}

// ── Attach to outer document ──────────────────────────────────────
document.addEventListener('mouseup', makeMouseUpHandler(null));
document.addEventListener('mousedown', makeMouseDownHandler());

// ── Attach to book content iframes ───────────────────────────────
function attachToIframe(iframe) {
  if (iframe._readflowAttached) return;
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;

    // iframe exists but content not loaded yet — wait for load event
    if (!doc || !doc.body || doc.readyState === 'loading') {
      iframe.addEventListener('load', () => attachToIframe(iframe), { once: true });
      return;
    }

    iframe._readflowAttached = true;
    console.log('[ReadFlow] attached to iframe:', iframe.src || '(about:blank)', '— readyState:', doc.readyState);
    doc.addEventListener('mouseup', makeMouseUpHandler(iframe));
    doc.addEventListener('mousedown', makeMouseDownHandler());
  } catch (e) {
    console.log('[ReadFlow] iframe access blocked:', e.message);
  }
}

function attachToAllIframes() {
  document.querySelectorAll('iframe').forEach(attachToIframe);
}

// Try immediately, after short delays (Play Books renders iframes late), and via MutationObserver
attachToAllIframes();
setTimeout(attachToAllIframes, 1000);
setTimeout(attachToAllIframes, 3000);

const observer = new MutationObserver(() => {
  removeIcon();
  removeTooltip();
  attachToAllIframes();
});

observer.observe(document.body, { childList: true, subtree: true });
