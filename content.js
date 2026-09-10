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
let resizeHandle = null;

// ── Debug mode ───────────────────────────────────────────────────────
// Toggled from the ReadFlow popup (two checkboxes there write
// chrome.storage.local keys 'debugMode' / 'debugModeError') — not a URL
// param (Play Books' own SPA router strips unrecognized query params on
// load, so a flag there never survives) and not window.localStorage
// (the popup and the injected page are different origins/contexts and
// don't share one; chrome.storage.local is the mechanism actually
// shared between them — same as apiKey below).
//
// Lets the whole drawer flow (loading → result → highlight → error) run
// with zero dependency on a real book or a real Gemini call: it skips
// the real cross-frame page-turn capture and the real
// chrome.runtime.sendMessage entirely, using canned pages and a canned
// analysis instead. Only ever consulted in the top frame — see
// onStartCapture/runDebugCapture below; nested reader frames never need
// it, since they never make the real Gemini call themselves. Read once,
// asynchronously, before initDrawer() runs (see the bootstrap below) so
// the tab's label is correct from its very first paint.
let DEBUG_MODE = false;
let DEBUG_FORCE_ERROR = false;

// Panel width: user-resizable via the drag handle, remembered across
// reloads since the content script re-injects fresh on every page load.
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 1000;
const PANEL_WIDTH_STORAGE_KEY = 'readflow-panel-width';
// How far the tab tucks under the panel's left edge (the tab sits below
// the panel in z-index — see .readflow-drawer-tab in styles.css — so the
// panel's own opaque edge is the only boundary ever visible). Measured
// live via getBoundingClientRect during debugging: even a 4px overlap
// already left zero actual gap (elementsFromPoint confirmed no pixel of
// page ever showed through), and the tab is only ~40px wide (vertical
// text, 8px side padding) — every extra pixel here comes straight out of
// the visible glyphs, not spare padding, so this stays as small as the
// pixel/DPR safety margin actually needs.
const TAB_OVERLAP_PX = 2;
// Half the resize handle's width: keeps its hit-area straddling the
// panel's actual edge (unrelated to how far the tab tucks under it).
const RESIZE_HANDLE_STRADDLE_PX = 3;
let panelWidth = clampPanelWidth(parseInt(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY), 10) || 360);

// Body text size: user-adjustable via the A－/A＋ buttons, independently
// remembered the same way. Only scales the reading content, not controls.
const BODY_FONT_SIZE_MIN = 12;
const BODY_FONT_SIZE_MAX = 22;
const BODY_FONT_SIZE_STORAGE_KEY = 'readflow-body-font-size';
let bodyFontSize = clampBodyFontSize(parseInt(localStorage.getItem(BODY_FONT_SIZE_STORAGE_KEY), 10) || 15);

if (window === window.top && window.location.pathname.startsWith('/books')) {
  chrome.storage.local.get(['debugMode', 'debugModeError'], ({ debugMode, debugModeError }) => {
    DEBUG_MODE = !!debugMode;
    DEBUG_FORCE_ERROR = DEBUG_MODE && !!debugModeError;
    initDrawer();
  });
}

function initDrawer() {
  if (document.getElementById('readflow-drawer-tab')) return;

  const tab = document.createElement('div');
  drawerTab = tab;
  tab.id = 'readflow-drawer-tab';
  tab.className = 'readflow-drawer-tab';
  tab.textContent = DEBUG_MODE ? '📖 導讀 (Debug)' : '📖 導讀';
  tab.title = 'ReadFlow: Chapter Guide';
  tab.addEventListener('click', () => setDrawerOpen(!drawerOpen));
  document.body.appendChild(tab);

  drawerBody = document.createElement('div');
  drawerBody.className = 'readflow-panel';
  document.body.appendChild(drawerBody);

  resizeHandle = document.createElement('div');
  resizeHandle.className = 'readflow-panel-resize-handle';
  resizeHandle.addEventListener('pointerdown', onResizeHandlePointerDown);
  document.body.appendChild(resizeHandle);

  applyPanelWidth(panelWidth);
  renderDrawerInput();
}

// The tab stays put at the page edge when closed, but shifts to sit at
// the open panel's left edge (like a handle attached to it) instead of
// floating on top of the panel's own content. Its `right` offset is set
// in JS (not CSS) because the panel's width — and therefore where its
// left edge lands — is now user-resizable.
function setDrawerOpen(open) {
  drawerOpen = open;
  drawerBody.classList.toggle('open', open);
  drawerTab.classList.toggle('open', open);
  resizeHandle.classList.toggle('open', open);
  drawerTab.style.right = open ? (panelWidth - TAB_OVERLAP_PX) + 'px' : '';
}

// Rounded to a whole pixel: dragging produces fractional widths (clientX
// is fractional on HiDPI/trackpad input), and a fractional value handed to
// both a `width` (layout/reflow) and a `right` offset (positioning,
// usually composited) can get device-pixel-snapped along two different
// code paths — leaving a permanent seam after the drag ends, not just a
// transient one. Committing an integer keeps both paths snapping to the
// same pixel.
function clampPanelWidth(width) {
  return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(width)));
}

function applyPanelWidth(width) {
  panelWidth = clampPanelWidth(width);
  drawerBody.style.width = panelWidth + 'px';
  resizeHandle.style.right = (panelWidth - RESIZE_HANDLE_STRADDLE_PX) + 'px';
  if (drawerOpen) drawerTab.style.right = (panelWidth - TAB_OVERLAP_PX) + 'px';
}

// Dragging left (pointer moves toward smaller clientX) widens the
// right-docked panel, so the delta is startX - currentX, not the reverse.
//
// Uses Pointer Capture (not plain mousemove/mouseup on document) because
// Play Books' reader content sits in a cross-origin iframe: a fast drag
// crosses into that iframe between two move events, and a document-level
// listener on the top frame never sees pointer events that land on a
// different document. setPointerCapture forces every subsequent event for
// this pointer to keep targeting the handle itself regardless of what's
// actually under the cursor, so fast drags no longer drop the gesture.
function onResizeHandlePointerDown(e) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = panelWidth;
  resizeHandle.classList.add('dragging');
  // The tab's `right` normally animates (0.25s) so open/close feels like a
  // slide. During a drag that same transition makes it visibly lag a
  // quarter-second behind the pointer instead of tracking it — drop it for
  // the duration of the drag so the tab follows 1:1, then restore it.
  drawerTab.classList.add('resizing');
  resizeHandle.setPointerCapture(e.pointerId);

  // pointermove can fire faster than the browser paints. Changing the
  // panel's `width` triggers layout (reflow), which is heavier than the
  // tab/handle's `right` offset — calling applyPanelWidth() straight from
  // every raw pointermove let the panel's reflow fall a frame behind the
  // tab, opening a visible gap while dragging fast. Collapsing all moves
  // between paints into a single rAF-scheduled update keeps the panel,
  // tab, and handle moving in the same frame.
  let pendingWidth = null;
  let rafId = null;
  function flush() {
    rafId = null;
    applyPanelWidth(pendingWidth);
  }
  function onPointerMove(moveEvent) {
    pendingWidth = startWidth + (startX - moveEvent.clientX);
    if (rafId === null) rafId = requestAnimationFrame(flush);
  }
  function onPointerUp(upEvent) {
    resizeHandle.releasePointerCapture(upEvent.pointerId);
    resizeHandle.removeEventListener('pointermove', onPointerMove);
    resizeHandle.removeEventListener('pointerup', onPointerUp);
    if (rafId !== null) { cancelAnimationFrame(rafId); flush(); }
    resizeHandle.classList.remove('dragging');
    drawerTab.classList.remove('resizing');
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(panelWidth));
  }
  resizeHandle.addEventListener('pointermove', onPointerMove);
  resizeHandle.addEventListener('pointerup', onPointerUp);
}

function clampBodyFontSize(size) {
  return Math.max(BODY_FONT_SIZE_MIN, Math.min(BODY_FONT_SIZE_MAX, size));
}

function applyBodyFontSize(size) {
  bodyFontSize = clampBodyFontSize(size);
  const body = drawerBody.querySelector('.readflow-panel-body');
  if (body) body.style.fontSize = bodyFontSize + 'px';
  localStorage.setItem(BODY_FONT_SIZE_STORAGE_KEY, String(bodyFontSize));
}

function renderDrawerInput() {
  drawerBody.innerHTML = `
    <label>往後幾頁
      <input type="number" id="readflow-page-count" value="10" min="1" max="100">
    </label>
    <label><input type="checkbox" id="readflow-current-page-only"> 只掃描目前頁面</label>
    <button id="readflow-start-capture">開始分析</button>
  `;
  const pageCountInput = drawerBody.querySelector('#readflow-page-count');
  drawerBody.querySelector('#readflow-current-page-only').addEventListener('change', (e) => {
    pageCountInput.disabled = e.target.checked;
  });
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
  const currentPageOnly = document.getElementById('readflow-current-page-only').checked;
  const input = document.getElementById('readflow-page-count');
  const pageCount = currentPageOnly ? 1 : Math.max(1, Math.min(100, parseInt(input.value, 10) || 10));

  if (DEBUG_MODE) {
    runDebugCapture(pageCount);
    return;
  }

  renderDrawerLoading(0, pageCount);
  setDrawerOpen(true);
  broadcastToDescendantFrames(window, { source: 'readflow', type: 'startChapterCapture', pageCount });

  clearTimeout(captureTimeoutId);
  captureTimeoutId = setTimeout(() => {
    renderDrawerResult('<span class="readflow-error">無法自動翻頁，請確認目前在書本閱讀頁面內，然後重新分析。</span>');
    setDrawerOpen(true);
  }, CAPTURE_TIMEOUT_MS);
}

// ── Debug mode: local, fake capture + analysis ──────────────────────
// Runs entirely in the top frame — no broadcast, no real frames, no
// chrome.runtime — so the whole drawer flow works on any page. A short
// per-page delay keeps the loading state visibly ticking instead of
// jumping straight to the result, which is what actually exercises
// renderDrawerLoading and the "(n/total)" text.
// ReadFlow analyzes English books for a Chinese-speaking reader (see
// background.js's CHAPTER_SYSTEM_PROMPT) — captured pages are English
// text, and the analysis explains English vocab/grammar in Chinese.
// These fake pages and the fake result below follow that same shape.
const DEBUG_PAGES = [
  '(Debug page 1) The rain drummed steadily on the tin awning above the shop. She pushed open the door beneath a faded poster, and the little bell overhead gave a soft jingle. The shopkeeper glanced up at her, then dropped his gaze again, absorbed in the pile of secondhand books behind the counter.',
  "(Debug page 2) It was purely by chance that she stumbled upon the notebook, its cover worn and mottled with age. Tucked between the pages was a letter that had never been sent, the ink smudged by damp, and something about it left her with a lingering, wistful sadness.",
  "(Debug page 3) She folded the letter carefully and slipped it back where she had found it, though she couldn't bring herself to return the notebook to the shelf. Even though the rain outside showed no sign of letting up, she decided to stay a little longer and finish reading it.",
  '(Debug page 4) Toward the final pages, the handwriting suddenly grew neat and deliberate, as if someone else had taken over the writing. That passage mentioned an address she had never heard of, along with a date just three days away.',
  '(Debug page 5) "So, are you going to buy it?" the shopkeeper finally asked. She looked up, hesitated for a moment, then nodded. The bell rang once more — this time, as she pushed the door open to leave.',
];

function runDebugCapture(pageCount) {
  setDrawerOpen(true);
  renderDrawerLoading(0, pageCount);

  const actualCount = Math.min(pageCount, DEBUG_PAGES.length);
  const reachedEnd = pageCount > DEBUG_PAGES.length;
  const collected = [];
  let current = 0;

  const tick = () => {
    current++;
    collected.push(DEBUG_PAGES[current - 1]);
    renderDrawerLoading(current, pageCount);
    if (current < actualCount) {
      setTimeout(tick, 180);
    } else {
      setTimeout(() => onDebugCaptureFinished(collected, reachedEnd), 220);
    }
  };
  setTimeout(tick, 180);
}

function onDebugCaptureFinished(pages, reachedEnd) {
  if (DEBUG_FORCE_ERROR) {
    renderDrawerResult('<span class="readflow-error">Error: (Debug 模擬) 無法連線至 Gemini，請稍後再試</span>');
    setDrawerOpen(true);
    return;
  }

  const note = reachedEnd
    ? '<p class="readflow-note">已到達本書結尾，以下為已收集的內容</p>'
    : '';
  const debugEcho = pages
    .map((p, i) => `* 第 ${i + 1} 頁：\`${p.slice(0, 30)}${p.length > 30 ? '…' : ''}\``)
    .join('\n');
  const fakeMarkdown = `**📖 章節大綱 (Outline)**
主角在雨夜舊書店中，意外發現一本封面斑駁的筆記本，裡頭夾著一封從未寄出的信，字跡因潮濕而暈染，讀來帶著一絲惆悵；隨著她繼續翻閱，某段文字忽然變得工整，像是另一人接手寫下，暗示還有未解的伏筆等著揭曉。

**📚 困難生字 (Difficult Vocabulary)**
* **mottled**（adj. 形容詞）：表面帶有斑駁色塊、不均勻，原文用來形容筆記本封面因年代久遠產生的痕跡（"its cover worn and mottled with age"），可以理解為「舊舊髒髒、顏色不均」。
* **wistful**（adj. 形容詞）：帶著淡淡感傷與懷念、若有所失的心情，原文 "left her with a lingering, wistful sadness" 描述她讀完信後的感受，語氣比 sad 更含蓄。
* **deliberate**（adj. 形容詞）：這裡指刻意、工整、經過用心書寫，不是「延遲」的意思；原文 "grew neat and deliberate" 形容字跡忽然變得端正、像是特意寫成的。

**📝 困難文法 (Difficult Grammar)**
* \`as if someone else had taken over the writing\`：\`as if\` 後面接過去完成式（had + p.p.），用來描述「其實未必是事實、只是看起來像」的假設情境——字跡看起來像換了另一個人寫，但實際上未必真的換了人，這種語氣在描述懷疑或推測時很常見。

**Debug：實際擷取到的內容**
${debugEcho}`;
  const usage = '<p class="readflow-usage">Token 用量（Debug 模擬）：輸入 812 ／ 輸出 356 ／ 總計 1168</p>';
  renderDrawerResult(note + addHighlightButtons(renderMarkdown(fakeMarkdown)) + usage);
  setDrawerOpen(true);
}

function renderDrawerLoading(current, total) {
  drawerBody.innerHTML = `<span class="readflow-loading">正在翻頁擷取內容 (${current}/${total})</span>`;
}

function renderDrawerResult(html) {
  drawerBody.innerHTML = `
    <div class="readflow-panel-controls">
      <button class="readflow-font-size-btn" data-delta="-1" title="縮小文字">A－</button>
      <button class="readflow-font-size-btn" data-delta="1" title="放大文字">A＋</button>
      <button class="readflow-panel-restart" title="重新分析">🔄</button>
    </div>
    <div class="readflow-panel-body"></div>
  `;
  drawerBody.querySelector('.readflow-panel-restart').addEventListener('click', renderDrawerInput);
  drawerBody.querySelectorAll('.readflow-font-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyBodyFontSize(bodyFontSize + parseInt(btn.dataset.delta, 10)));
  });
  drawerBody.querySelector('.readflow-panel-body').innerHTML = html;
  applyBodyFontSize(bodyFontSize);
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
// which renderMarkdown turns into "<li><strong>word</strong>：...". Anchoring
// to <li><strong> keeps the button on the vocab word itself, not on any bold
// sub-label (解釋／例句語境／白話理解...) Gemini adds further into the same
// list item. Grammar entries use `code` spans instead, so this only ever
// matches vocab.
function addHighlightButtons(html) {
  return html.replace(/(<li>)<strong>([^<]+)<\/strong>([^：<]*)：/g, (match, li, word, betweenText) => {
    const safeWord = word.replace(/"/g, '&quot;');
    return `${li}<strong>${word}</strong>${betweenText}： <button class="readflow-highlight-btn" data-word="${safeWord}">畫記</button>`;
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
