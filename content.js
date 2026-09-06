console.log('[ReadFlow] loaded in:', window.location.href);

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
  icon.addEventListener('click', toggleInputPanel);
  document.body.appendChild(icon);
}

let inputPanel = null;

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
  console.log('[ReadFlow] Chapter Guide requested, pageCount =', pageCount);
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
    collected.push(extractPageText());
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

function extractPageText() {
  const page = document.querySelector('.reader-rendered-page');
  return page ? page.innerText.trim() : '';
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
