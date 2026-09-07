console.log('[ReadFlow] loaded in:', window.location.href);

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

// ── Top frame: persistent Chapter Guide drawer ──────────────────────
// One collapsible drawer — an always-visible edge tab plus a sliding
// body — replaces what used to be a floating icon, a separate small
// input popup, and a separate result sidebar. Injected only into the
// top-level document (never into any iframe), guarded by an existence
// check so it can't be duplicated by iframe re-injection, and never
// depends on iframe-relative positioning.
//
// The manifest's content_scripts match is `play.google.com/*` (not
// narrowed to `/books*`) because `match_origin_as_fallback` requires
// every match pattern in the block to have a `*` path — Chrome refuses
// to load the manifest otherwise. So the script does load on every
// play.google.com page; the path check below is what keeps the drawer
// itself from appearing outside the book reader.
let drawerBody = null;
let drawerOpen = false;
let drawerTab = null;

if (window === window.top && window.location.pathname.startsWith('/books')) {
  initDrawer();
}

function initDrawer() {
  if (document.getElementById('readflow-drawer-tab')) return;

  const tab = document.createElement('div');
  drawerTab = tab;
  tab.id = 'readflow-drawer-tab';
  tab.className = 'readflow-drawer-tab';
  tab.textContent = '📖 導讀';
  tab.title = 'ReadFlow: Chapter Guide';
  tab.addEventListener('click', () => setDrawerOpen(!drawerOpen));
  document.body.appendChild(tab);

  drawerBody = document.createElement('div');
  drawerBody.className = 'readflow-panel';
  document.body.appendChild(drawerBody);

  renderDrawerInput();
}

// The tab stays put at the page edge when closed, but shifts to sit at
// the open panel's left edge (like a handle attached to it) instead of
// floating on top of the panel's own content.
function setDrawerOpen(open) {
  drawerOpen = open;
  drawerBody.classList.toggle('open', open);
  drawerTab.classList.toggle('open', open);
}

function renderDrawerInput() {
  drawerBody.innerHTML = `
    <label>往後幾頁
      <input type="number" id="readflow-page-count" value="10" min="1" max="100">
    </label>
    <button id="readflow-start-capture">開始分析</button>
  `;
  drawerBody.querySelector('#readflow-start-capture').addEventListener('click', onStartCapture);
}

// If the reader-content frame never responds (wrong page, or its DOM
// doesn't match what we look for), nothing would otherwise ever move
// the drawer past "0/N" — this timeout turns silence into a visible
// error instead of an infinite spinner. Cleared as soon as any real
// progress or result arrives.
const CAPTURE_TIMEOUT_MS = 6000;
let captureTimeoutId = null;

function onStartCapture() {
  const input = document.getElementById('readflow-page-count');
  const pageCount = Math.max(1, Math.min(100, parseInt(input.value, 10) || 10));
  renderDrawerLoading(0, pageCount);
  setDrawerOpen(true);
  broadcastToDescendantFrames(window, { source: 'readflow', type: 'startChapterCapture', pageCount });

  clearTimeout(captureTimeoutId);
  captureTimeoutId = setTimeout(() => {
    renderDrawerResult('<span class="readflow-error">無法自動翻頁，請確認目前在書本閱讀頁面內，然後重新分析。</span>');
    setDrawerOpen(true);
  }, CAPTURE_TIMEOUT_MS);
}

function renderDrawerLoading(current, total) {
  drawerBody.innerHTML = `<span class="readflow-loading">正在翻頁擷取內容 (${current}/${total})</span>`;
}

function renderDrawerResult(html) {
  drawerBody.innerHTML = `
    <button class="readflow-panel-restart" title="重新分析">🔄</button>
    <div class="readflow-panel-body"></div>
  `;
  drawerBody.querySelector('.readflow-panel-restart').addEventListener('click', renderDrawerInput);
  drawerBody.querySelector('.readflow-panel-body').innerHTML = html;
}

function broadcastToDescendantFrames(win, message, depth = 0) {
  if (depth > 5) return;
  try {
    for (let i = 0; i < win.frames.length; i++) {
      const frameWin = win.frames[i];
      frameWin.postMessage(message, '*');
      broadcastToDescendantFrames(frameWin, message, depth + 1);
    }
  } catch (e) {
    // cross-origin frame access blocked at this depth; nothing more to do
  }
}

// Vocab entries render as "**word**：explanation" (see CHAPTER_SYSTEM_PROMPT),
// which renderMarkdown turns into "<strong>word</strong>：...". Grammar
// entries use `code` spans instead, so this only ever matches vocab.
function addHighlightButtons(html) {
  return html.replace(/<strong>([^<]+)<\/strong>([^：<]*)：/g, (match, word, betweenText) => {
    const safeWord = word.replace(/"/g, '&quot;');
    return `<strong>${word}</strong>${betweenText}： <button class="readflow-highlight-btn" data-word="${safeWord}">畫記</button>`;
  });
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.readflow-highlight-btn');
  if (!btn) return;
  btn.classList.toggle('active');
  broadcastToDescendantFrames(window, { source: 'readflow', type: 'toggleHighlightRequest', word: btn.dataset.word });
});

function updateLoadingProgress(current, total) {
  clearTimeout(captureTimeoutId);
  if (!drawerBody) return;
  renderDrawerLoading(current, total);
}

function onCaptureFinished(pages, reachedEnd) {
  clearTimeout(captureTimeoutId);
  chrome.storage.local.get(['apiKey'], ({ apiKey }) => {
    if (!apiKey) {
      renderDrawerResult('<span class="readflow-error">No API key. Click the ReadFlow icon in the toolbar to add one.</span>');
      setDrawerOpen(true);
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'analyzeChapter', pages, apiKey },
      (response) => {
        if (chrome.runtime.lastError || response?.error) {
          const msg = response?.error || chrome.runtime.lastError?.message;
          renderDrawerResult(`<span class="readflow-error">Error: ${msg}</span>`);
          setDrawerOpen(true);
          return;
        }
        const note = reachedEnd
          ? '<p class="readflow-note">已到達本書結尾，以下為已收集的內容</p>'
          : '';
        const usage = response.usage
          ? `<p class="readflow-usage">Token 用量：輸入 ${response.usage.promptTokenCount} ／ 輸出 ${response.usage.candidatesTokenCount} ／ 總計 ${response.usage.totalTokenCount}</p>`
          : '';
        renderDrawerResult(note + addHighlightButtons(renderMarkdown(response.result)) + usage);
        setDrawerOpen(true);
      }
    );
  });
}

// ── Shared: cross-frame messaging for Chapter Guide ─────────────────
// Runs in every frame. Only the frame that actually contains the
// reader's page-turn controls acts on 'startChapterCapture'; every
// other frame's handleStartChapterCapture no-ops (see the
// .forward-gutter existence check below). window.top always resolves
// to the same real top-level document regardless of nesting depth, so
// posting to it from any frame reaches the top frame's listener.
window.addEventListener('message', (event) => {
  const data = event.data;
  if (data?.source !== 'readflow') return;
  if (data.type === 'startChapterCapture') handleStartChapterCapture(data.pageCount);
  if (data.type === 'chapterCaptureProgress') updateLoadingProgress(data.current, data.total);
  if (data.type === 'chapterCaptureResult') onCaptureFinished(data.pages, data.reachedEnd);
  if (data.type === 'toggleHighlightRequest') applyHighlightToggle(data.word);
  if (data.type === 'extractPageTextRequest') {
    event.source.postMessage({
      source: 'readflow',
      type: 'extractPageTextResponse',
      requestId: data.requestId,
      text: extractLocalText(),
    }, '*');
  }
});

// Guards against a second startChapterCapture arriving while a capture
// is already running in this frame (e.g. the user reopens the drawer
// mid-capture and hits "開始分析" again) — two concurrent loops would
// interleave forward/backward clicks and leave the book on the wrong
// page. The frame just ignores the second request; only one capture
// per frame runs at a time.
let capturing = false;

function handleStartChapterCapture(pageCount) {
  if (!document.querySelector('.forward-gutter')) return; // not the reader-content frame
  if (capturing) return;
  capturing = true;
  runChapterCapture(pageCount).finally(() => { capturing = false; });
}

async function runChapterCapture(pageCount) {
  const collected = [];
  let advances = 0;
  let reachedEnd = false;

  for (let i = 0; i < pageCount; i++) {
    collected.push(await extractPageText());
    notifyProgress(i + 1, pageCount);

    if (i === pageCount - 1) break;

    if (!clickForward()) { reachedEnd = true; break; }
    advances++;
    await wait(500);
  }

  for (let i = 0; i < advances; i++) {
    clickBackward();
    await wait(200);
  }

  window.top.postMessage({
    source: 'readflow',
    type: 'chapterCaptureResult',
    pages: collected,
    reachedEnd,
  }, '*');
}

// Marks (or unmarks) every visible occurrence of `word` in this frame's
// body with a <mark>. Runs in every frame reached by
// broadcastToDescendantFrames; only the frame that actually has the
// word in its text will find anything to do.
const highlightedWords = new Set();

function applyHighlightToggle(word) {
  const key = word.toLowerCase();
  if (highlightedWords.has(key)) {
    document.querySelectorAll('mark.readflow-highlight[data-word="' + CSS.escape(key) + '"]').forEach((mark) => {
      mark.replaceWith(document.createTextNode(mark.textContent));
    });
    highlightedWords.delete(key);
    return;
  }

  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('\\b(' + escaped + ')\\b', 'gi');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const matches = [];
  let node;
  while ((node = walker.nextNode())) {
    if (regex.test(node.textContent)) matches.push(node);
    regex.lastIndex = 0;
  }
  if (matches.length === 0) return; // not the right frame

  matches.forEach((textNode) => {
    const parts = textNode.textContent.split(regex);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const mark = document.createElement('mark');
        mark.className = 'readflow-highlight';
        mark.dataset.word = key;
        mark.textContent = parts[i];
        frag.appendChild(mark);
      } else if (parts[i]) {
        frag.appendChild(document.createTextNode(parts[i]));
      }
    }
    textNode.replaceWith(frag);
  });
  highlightedWords.add(key);
}

// The frame with the page-turn controls is a shell around a further
// nested frame that actually holds the readable page text; that nested
// frame is cross-origin from here, so its contentDocument can't be read
// directly (confirmed live: iframe.contentDocument throws/returns null).
// Ask it for its text over postMessage instead — it runs this same
// content.js (all_frames + match_origin_as_fallback), so it can answer.
function extractLocalText() {
  const page = document.querySelector('.reader-rendered-page');
  if (page && page.innerText.trim()) return page.innerText.trim();
  return document.body.innerText.trim();
}

function extractPageText() {
  const localText = extractLocalText();
  if (localText) return Promise.resolve(localText);

  const iframes = Array.from(document.querySelectorAll('iframe'));
  if (iframes.length === 0) return Promise.resolve('');

  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onResponse);
      resolve('');
    }, 1000);

    function onResponse(event) {
      const data = event.data;
      if (data?.source !== 'readflow' || data.type !== 'extractPageTextResponse') return;
      if (data.requestId !== requestId || settled) return;
      settled = true;
      clearTimeout(timeoutId);
      window.removeEventListener('message', onResponse);
      resolve(data.text || '');
    }
    window.addEventListener('message', onResponse);

    iframes.forEach((frame) => {
      try {
        frame.contentWindow.postMessage({ source: 'readflow', type: 'extractPageTextRequest', requestId }, '*');
      } catch (e) {
        // cross-origin frame access blocked; nothing more to do
      }
    });
  });
}

function clickForward() {
  const gutter = document.querySelector('.forward-gutter');
  if (!gutter) return false;
  gutter.click();
  return true;
}

function clickBackward() {
  const gutter = document.querySelector('.backward-gutter');
  if (gutter) gutter.click();
}

function notifyProgress(current, total) {
  window.top.postMessage({
    source: 'readflow',
    type: 'chapterCaptureProgress',
    current,
    total,
  }, '*');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
