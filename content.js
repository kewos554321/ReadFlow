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

// ── Top frame: persistent Chapter Guide icon ────────────────────────
// Injected only into the top-level document (never into any iframe),
// guarded by an existence check — so it can't be duplicated by
// iframe re-injection and never depends on iframe-relative positioning.
if (window === window.top) {
  initChapterGuideIcon();
}

function initChapterGuideIcon() {
  if (document.getElementById('readflow-page-icon')) return;

  const icon = document.createElement('div');
  icon.id = 'readflow-page-icon';
  icon.className = 'readflow-page-icon';
  icon.textContent = '📖';
  icon.title = 'ReadFlow: Chapter Guide';
  icon.addEventListener('click', onIconClick);
  document.body.appendChild(icon);
}

let inputPanel = null;

// The icon has three things it might need to do, in priority order:
// re-show a result the user closed (so closing it isn't a dead end),
// close whatever's currently open, or start a fresh analysis.
function onIconClick() {
  if (resultPanel && resultPanel.style.display === 'none') {
    resultPanel.style.display = '';
    return;
  }
  if (resultPanel) { closeResultPanel(); return; }
  toggleInputPanel();
}

function toggleInputPanel() {
  if (inputPanel) { closeInputPanel(); return; }
  openInputPanel();
}

function openInputPanel() {
  inputPanel = document.createElement('div');
  inputPanel.className = 'readflow-input-panel';
  inputPanel.innerHTML = `
    <label>往後幾頁
      <input type="number" id="readflow-page-count" value="10" min="1" max="100">
    </label>
    <button id="readflow-start-capture">開始分析</button>
  `;
  document.body.appendChild(inputPanel);
  inputPanel.querySelector('#readflow-start-capture').addEventListener('click', onStartCapture);
}

function closeInputPanel() {
  if (inputPanel) { inputPanel.remove(); inputPanel = null; }
}

function onStartCapture() {
  const input = document.getElementById('readflow-page-count');
  const pageCount = Math.max(1, parseInt(input.value, 10) || 10);
  closeInputPanel();
  showResultPanel(`<span class="readflow-loading">正在翻頁擷取內容 (0/${pageCount})</span>`);
  broadcastToDescendantFrames(window, { source: 'readflow', type: 'startChapterCapture', pageCount });
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

let resultPanel = null;

function showResultPanel(html) {
  if (!resultPanel) {
    resultPanel = document.createElement('div');
    resultPanel.className = 'readflow-panel';
    resultPanel.innerHTML = `
      <button class="readflow-panel-restart" title="重新分析">🔄</button>
      <button class="readflow-panel-close">×</button>
      <div class="readflow-panel-body"></div>
    `;
    resultPanel.querySelector('.readflow-panel-close').addEventListener('click', closeResultPanel);
    resultPanel.querySelector('.readflow-panel-restart').addEventListener('click', () => {
      closeResultPanel();
      toggleInputPanel();
    });
    document.body.appendChild(resultPanel);
  }
  resultPanel.style.display = '';
  resultPanel.querySelector('.readflow-panel-body').innerHTML = html;
}

// Hides rather than destroys the panel, so closing it (or the icon) can
// bring the last result straight back without re-running the analysis.
function closeResultPanel() {
  if (resultPanel) resultPanel.style.display = 'none';
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
  if (!resultPanel) return;
  resultPanel.querySelector('.readflow-panel-body').innerHTML =
    `<span class="readflow-loading">正在翻頁擷取內容 (${current}/${total})</span>`;
}

function onCaptureFinished(pages, reachedEnd) {
  chrome.storage.local.get(['apiKey'], ({ apiKey }) => {
    if (!apiKey) {
      showResultPanel('<span class="readflow-error">No API key. Click the ReadFlow icon in the toolbar to add one.</span>');
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'analyzeChapter', pages, apiKey },
      (response) => {
        if (chrome.runtime.lastError || response?.error) {
          const msg = response?.error || chrome.runtime.lastError?.message;
          showResultPanel(`<span class="readflow-error">Error: ${msg}</span>`);
          return;
        }
        const note = reachedEnd
          ? '<p class="readflow-note">已到達本書結尾，以下為已收集的內容</p>'
          : '';
        showResultPanel(note + addHighlightButtons(renderMarkdown(response.result)));
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

function handleStartChapterCapture(pageCount) {
  if (!document.querySelector('.forward-gutter')) return; // not the reader-content frame
  runChapterCapture(pageCount);
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
