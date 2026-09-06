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
