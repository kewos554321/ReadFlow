// ── Inlined: isBlockElement + extractContext ──────────────────────
const BLOCK_TAGS = ['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'TD'];

function isBlockElement(el) {
  return BLOCK_TAGS.includes(el.tagName);
}

function extractContext() {
  const selection = window.getSelection();
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

// ── Event listeners ───────────────────────────────────────────────
function onMouseUp(e) {
  if (e.button !== 0) return;
  if (floatingIcon?.contains(e.target) || tooltip?.contains(e.target)) return;

  setTimeout(() => {
    const context = extractContext();
    if (!context) { removeIcon(); return; }

    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();

    pendingContext = context;
    pendingRect = rect;
    createIcon(rect);
  }, 10);
}

function onMouseDown(e) {
  if (floatingIcon?.contains(e.target) || tooltip?.contains(e.target)) return;
  removeIcon();
  removeTooltip();
}

document.addEventListener('mouseup', onMouseUp);
document.addEventListener('mousedown', onMouseDown);

// ── MutationObserver: handle page turns ───────────────────────────
const observer = new MutationObserver(() => {
  removeIcon();
  removeTooltip();
});

observer.observe(document.body, { childList: true, subtree: false });
