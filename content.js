console.log('[ReadFlow] loaded in:', window.location.href);

// ── HTML escaping ────────────────────────────────────────────────
// Every dynamic string interpolated into innerHTML below (Gemini's
// output, a user-typed API key) goes through this first — Gemini's
// output is untrusted content, not UI copy we wrote ourselves.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Inline icons ─────────────────────────────────────────────────
// Lucide paths (stroke-width 2.75), copied from the Organic mockup.
// No icon library — this project has no build step to pull one in.
const ICON_PATHS = {
  book: ['M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'],
  gear: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2'],
  reanalyze: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  speak: ['M11 5 6 9H2v6h4l5 4z', 'M15.54 8.46a5 5 0 0 1 0 7.07'],
  mark: ['m9 11-6 6v3h9l3-3', 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'],
  export: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  history: ['M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z', 'M12 6v6l4 2'],
};

function svgIcon(name, size) {
  const paths = (ICON_PATHS[name] || []).map((d) => `<path d="${d}"></path>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

// ── Pure helpers (unit-tested — see tests/content.test.js) ───────
function clampPageCount(count) {
  return Math.max(1, Math.min(100, count));
}

function computeTabCounts(result) {
  return {
    outline: result.points.length,
    vocab: result.vocab.length,
    grammar: result.grammar.length,
  };
}

function maskApiKey(key) {
  if (!key || key.length <= 8) return key || '';
  return key.slice(0, 4) + '····' + key.slice(-4);
}

function providerLabel(provider) {
  return provider === 'deepseek' ? 'DeepSeek' : 'Gemini';
}

// Gemini used a single unnamed `apiKey` field before providers existed —
// fall back to it so upgrading users don't lose an already-saved key.
function pickApiKeyForProvider(provider, keys) {
  const stored = provider === 'deepseek' ? keys.deepseekApiKey : keys.geminiApiKey;
  if (stored) return stored;
  return provider === 'gemini' ? (keys.apiKey || '') : '';
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
let DEBUG_MODE = false;
let DEBUG_FORCE_ERROR = false;

// Panel width: user-resizable via the drag handle, remembered across
// reloads since the content script re-injects fresh on every page load.
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 1000;
const PANEL_WIDTH_STORAGE_KEY = 'readflow-panel-width';
const TAB_OVERLAP_PX = 2;
const RESIZE_HANDLE_STRADDLE_PX = 3;
let panelWidth = clampPanelWidth(parseInt(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY), 10) || 360);

// Body text size: user-adjustable via the A－/A＋ buttons, independently
// remembered the same way. Only scales the reading content, not controls.
const BODY_FONT_SIZE_MIN = 12;
const BODY_FONT_SIZE_MAX = 22;
const BODY_FONT_SIZE_STORAGE_KEY = 'readflow-body-font-size';
let bodyFontSize = clampBodyFontSize(parseInt(localStorage.getItem(BODY_FONT_SIZE_STORAGE_KEY), 10) || 15);

// ── Chapter Guide state ──────────────────────────────────────────
let panelLevel = 'B2';               // 'B1' | 'B2' | 'C1'
let panelPageCount = 10;
let panelCurrentPageOnly = false;
let settingsOverlayOpen = false;     // gear-icon overlay, result state only
let settingsDraft = null;            // { level, pageCount, currentPageOnly } while the overlay is open
let markedWords = new Set();         // words this frame has asked to highlight, for 畫記 button state
let markedGrammar = new Set();       // normalized frags this frame has asked to underline, for 畫記 button state
let lastResult = null;               // { scene, points, vocab, grammar }
let lastMeta = null;                 // { pageCount, level, reachedEnd, usage, debug }
let resultTab = 'outline';           // 'outline' | 'vocab' | 'grammar'
let currentView = 'start';           // 'start' | 'loading' | 'result' | 'error'
let panelProvider = 'gemini';        // 'gemini' | 'deepseek'
let currentApiKey = '';
let apiKeyEditOpen = false;

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
  tab.textContent = DEBUG_MODE ? '導讀 (Debug)' : '導讀';
  tab.title = 'ReadFlow: Chapter Guide';
  tab.addEventListener('click', () => setDrawerOpen(!drawerOpen));
  document.body.appendChild(tab);

  drawerBody = document.createElement('div');
  drawerBody.className = 'readflow-panel';
  drawerBody.addEventListener('click', onDrawerClick);
  drawerBody.addEventListener('change', onDrawerChange);
  document.body.appendChild(drawerBody);

  resizeHandle = document.createElement('div');
  resizeHandle.className = 'readflow-panel-resize-handle';
  resizeHandle.addEventListener('pointerdown', onResizeHandlePointerDown);
  document.body.appendChild(resizeHandle);

  applyPanelWidth(panelWidth);

  chrome.storage.local.get(['provider', 'geminiApiKey', 'deepseekApiKey', 'apiKey'], (stored) => {
    panelProvider = stored.provider || 'gemini';
    currentApiKey = pickApiKeyForProvider(panelProvider, stored);
    renderDrawerStart();
  });
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

function clampPanelWidth(width) {
  return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(width)));
}

function applyPanelWidth(width) {
  panelWidth = clampPanelWidth(width);
  drawerBody.style.width = panelWidth + 'px';
  resizeHandle.style.right = (panelWidth - RESIZE_HANDLE_STRADDLE_PX) + 'px';
  if (drawerOpen) drawerTab.style.right = (panelWidth - TAB_OVERLAP_PX) + 'px';
}

function onResizeHandlePointerDown(e) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = panelWidth;
  resizeHandle.classList.add('dragging');
  drawerTab.classList.add('resizing');
  resizeHandle.setPointerCapture(e.pointerId);

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
  const body = drawerBody.querySelector('.readflow-body');
  if (body) body.style.fontSize = bodyFontSize + 'px';
  localStorage.setItem(BODY_FONT_SIZE_STORAGE_KEY, String(bodyFontSize));
}

// ── Rendering: shared settings fields ────────────────────────────
// Used both inline as the drawer's start state (before any analysis)
// and inside the gear-icon overlay once a result exists. `scope` is
// 'start' or 'overlay' — the click/change dispatcher below uses it to
// decide whether to mutate the live panel* state directly or the
// draft copy the overlay edits before "儲存並重新分析"/"取消".
function renderSettingsFields(source, scope) {
  const levels = ['B1', 'B2', 'C1'];
  const levelButtons = levels.map((lv) => `
    <button class="readflow-level-opt${source.level === lv ? ' active' : ''}" data-action="pick-level" data-scope="${scope}" data-level="${lv}">${lv}</button>
  `).join('');

  const apiKeyDisplay = currentApiKey
    ? `<span class="readflow-apikey-value">${escapeHtml(maskApiKey(currentApiKey))}</span><span class="readflow-apikey-tag verified">已驗證</span>`
    : `<span class="readflow-apikey-tag missing">尚未設定</span>`;
  const apiKeyPlaceholder = panelProvider === 'deepseek' ? 'sk-...' : 'AIza...';

  return `
    <div class="readflow-settings">
      <div class="readflow-settings-group">
        <div class="readflow-settings-label">英文程度</div>
        <div class="readflow-level-seg">${levelButtons}</div>
      </div>
      <div class="readflow-settings-group">
        <div class="readflow-settings-label">每次擷取頁數</div>
        <div class="readflow-stepper">
          <button class="readflow-stepper-btn" data-action="dec-pages" data-scope="${scope}" ${source.currentPageOnly ? 'disabled' : ''}>−</button>
          <span class="readflow-stepper-value">${source.pageCount}</span>
          <button class="readflow-stepper-btn" data-action="inc-pages" data-scope="${scope}" ${source.currentPageOnly ? 'disabled' : ''}>+</button>
          <span class="readflow-stepper-unit">頁</span>
        </div>
        <label class="readflow-checkbox-row">
          <input type="checkbox" data-action="toggle-current-page" data-scope="${scope}" ${source.currentPageOnly ? 'checked' : ''}>
          只掃描目前頁面
        </label>
      </div>
      <div class="readflow-settings-group">
        <div class="readflow-settings-label">使用的模型</div>
        <select class="readflow-provider-select" data-action="pick-provider">
          <option value="gemini"${panelProvider === 'gemini' ? ' selected' : ''}>Gemini</option>
          <option value="deepseek"${panelProvider === 'deepseek' ? ' selected' : ''}>DeepSeek</option>
        </select>
      </div>
      <div class="readflow-settings-group">
        <div class="readflow-settings-label">${providerLabel(panelProvider)} API Key</div>
        <div class="readflow-apikey-row">
          ${apiKeyDisplay}
          <span class="readflow-spacer"></span>
          <button class="readflow-link-btn" data-action="apikey-edit-toggle">更改</button>
          <div class="readflow-apikey-edit${apiKeyEditOpen ? ' open' : ''}">
            <input type="password" id="readflow-apikey-input" placeholder="${apiKeyPlaceholder}">
            <button class="readflow-btn readflow-btn-secondary" data-action="apikey-save">儲存</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function currentSettingsSource() {
  return { level: panelLevel, pageCount: panelPageCount, currentPageOnly: panelCurrentPageOnly };
}

// ── Rendering: start state (before any analysis) ─────────────────
function renderDrawerStart() {
  currentView = 'start';
  drawerBody.innerHTML = `
    <div class="readflow-header">
      <div class="readflow-header-row">
        <span class="readflow-header-icon">${svgIcon('book', 19)}</span>
        <div class="readflow-header-title">
          <h2>ReadFlow</h2>
          <div class="readflow-header-meta">設定完成後開始分析這段內容</div>
        </div>
        <button class="readflow-icon-btn readflow-icon-btn-plain" data-action="close-drawer" title="收起">${svgIcon('close', 17)}</button>
      </div>
    </div>
    <div class="readflow-body">
      ${renderSettingsFields(currentSettingsSource(), 'start')}
    </div>
    <div class="readflow-footer">
      <button class="readflow-btn readflow-btn-primary readflow-btn-block" data-action="start-capture">開始分析</button>
    </div>
  `;
}

// ── Rendering: loading state ──────────────────────────────────────
function renderDrawerLoading(current, total) {
  currentView = 'loading';
  drawerBody.innerHTML = `
    <div class="readflow-header">
      <div class="readflow-header-row">
        <span class="readflow-header-icon">${svgIcon('book', 19)}</span>
        <div class="readflow-header-title"><h2>正在分析</h2></div>
      </div>
    </div>
    <div class="readflow-body">
      <span class="readflow-loading">正在翻頁擷取內容 (${current}/${total})</span>
    </div>
  `;
}

// ── Rendering: error state ────────────────────────────────────────
function renderDrawerError(message) {
  currentView = 'error';
  drawerBody.innerHTML = `
    <div class="readflow-header">
      <div class="readflow-header-row">
        <span class="readflow-header-icon">${svgIcon('book', 19)}</span>
        <div class="readflow-header-title"><h2>發生錯誤</h2></div>
        <button class="readflow-icon-btn readflow-icon-btn-plain" data-action="close-drawer" title="收起">${svgIcon('close', 17)}</button>
      </div>
    </div>
    <div class="readflow-body">
      <div class="readflow-error">${escapeHtml(message)}</div>
      <button class="readflow-btn readflow-btn-secondary" style="margin-top:16px" data-action="error-back">返回設定</button>
    </div>
  `;
}

// ── Rendering: result state (tabs) ────────────────────────────────
function renderTabBody(result, tab) {
  if (tab === 'outline') {
    const points = result.points.map((p) => `
      <div class="readflow-outline-point">
        <span class="readflow-outline-dot"></span>
        <p>${escapeHtml(p)}</p>
      </div>
    `).join('');
    return `
      <div class="readflow-outline">
        <div class="readflow-outline-scene">
          <div class="readflow-outline-scene-label">場景</div>
          <p>${escapeHtml(result.scene)}</p>
        </div>
        <div class="readflow-outline-points">${points}</div>
        <p class="readflow-outline-footnote">不含結局或關鍵轉折。</p>
      </div>
    `;
  }

  if (tab === 'vocab') {
    const cards = result.vocab.map((v) => {
      const marked = markedWords.has(v.word.toLowerCase());
      return `
        <div class="readflow-vocab-card">
          <div class="readflow-vocab-head">
            <span class="readflow-vocab-word">${escapeHtml(v.word)}</span>
            <span class="readflow-vocab-pos">${escapeHtml(v.pos)}</span>
            <span class="readflow-spacer"></span>
            <button class="readflow-speak-btn" data-action="speak" data-word="${escapeHtml(v.word)}" title="朗讀">${svgIcon('speak', 15)}</button>
            <button class="readflow-mark-btn${marked ? ' active' : ''}" data-action="toggle-mark" data-word="${escapeHtml(v.word)}">${svgIcon('mark', 14)}畫記</button>
          </div>
          <p class="readflow-vocab-zh">${escapeHtml(v.zh)}</p>
          <p class="readflow-vocab-quote">${escapeHtml(v.quote)}</p>
        </div>
      `;
    }).join('');
    return `<div class="readflow-vocab-list">${cards}</div>`;
  }

  const cards = result.grammar.map((g) => {
    const marked = markedGrammar.has(normalizeFragKey(g.frag));
    return `
    <div class="readflow-grammar-card">
      <code class="readflow-grammar-frag">${escapeHtml(g.frag)}</code>
      <p class="readflow-grammar-note">${escapeHtml(g.note)}</p>
      <div class="readflow-grammar-rewrite-row">
        <span class="readflow-grammar-rewrite-label">改寫</span>
        <p>${escapeHtml(g.rewrite)}</p>
      </div>
      <div class="readflow-grammar-actions">
        <span class="readflow-spacer"></span>
        <button class="readflow-mark-btn${marked ? ' active' : ''}" data-action="toggle-grammar-mark" data-frag="${escapeHtml(g.frag)}" title="在內文中標示這段（底線）">${svgIcon('mark', 14)}畫記</button>
      </div>
    </div>
  `;
  }).join('');
  return `<div class="readflow-grammar-list">${cards}</div>`;
}

function renderSettingsOverlayHtml() {
  return `
    <div class="readflow-settings-overlay">
      <div class="readflow-settings-card">
        <div class="readflow-settings-card-head">
          <h3>分析設定</h3>
          <button class="readflow-icon-btn readflow-icon-btn-plain" data-action="close-settings" title="關閉">${svgIcon('close', 16)}</button>
        </div>
        ${renderSettingsFields(settingsDraft, 'overlay')}
        <div class="readflow-settings-actions">
          <button class="readflow-btn readflow-btn-secondary" data-action="cancel-settings">取消</button>
          <button class="readflow-btn readflow-btn-primary" data-action="save-settings">儲存並重新分析</button>
        </div>
      </div>
    </div>
  `;
}

function renderDrawerResult() {
  currentView = 'result';
  const result = lastResult;
  const meta = lastMeta;
  const counts = computeTabCounts(result);
  const tabs = [
    ['outline', '大綱', counts.outline],
    ['vocab', '生字', counts.vocab],
    ['grammar', '文法', counts.grammar],
  ];
  const tabButtons = tabs.map(([key, name, count]) => `
    <button class="readflow-tab${resultTab === key ? ' active' : ''}" data-action="pick-tab" data-tab="${key}">
      ${escapeHtml(name)}<span class="readflow-tab-badge">${count}</span>
    </button>
  `).join('');

  const noteHtml = meta.reachedEnd
    ? `<div class="readflow-note">已到達本書結尾，以下為已收集的內容</div>`
    : '';
  const usageHtml = meta.usage
    ? `<div class="readflow-usage">Token 用量${meta.debug ? '（Debug 模擬）' : ''}：輸入 ${meta.usage.promptTokenCount} ／ 輸出 ${meta.usage.candidatesTokenCount} ／ 總計 ${meta.usage.totalTokenCount}</div>`
    : '';

  drawerBody.innerHTML = `
    <div class="readflow-header">
      <div class="readflow-header-row">
        <span class="readflow-header-icon">${svgIcon('book', 19)}</span>
        <div class="readflow-header-title">
          <h2>本段導讀${DEBUG_MODE ? '（Debug）' : ''}</h2>
          <div class="readflow-header-meta">${meta.pageCount} 頁 · 程度 ${meta.level} · 剛剛完成</div>
        </div>
        <button class="readflow-icon-btn readflow-icon-btn-text" data-action="font-dec" title="縮小文字">A－</button>
        <button class="readflow-icon-btn readflow-icon-btn-text" data-action="font-inc" title="放大文字">A＋</button>
        <button class="readflow-icon-btn" data-action="open-settings" title="設定">${svgIcon('gear', 17)}</button>
        <button class="readflow-icon-btn" data-action="reanalyze" title="重新分析">${svgIcon('reanalyze', 17)}</button>
        <button class="readflow-icon-btn readflow-icon-btn-plain" data-action="close-drawer" title="收起">${svgIcon('close', 17)}</button>
      </div>
      <div class="readflow-tabs">${tabButtons}</div>
    </div>
    <div class="readflow-body">
      ${noteHtml}
      ${renderTabBody(result, resultTab)}
      ${usageHtml}
    </div>
    <div class="readflow-footer">
      <button class="readflow-btn readflow-btn-primary readflow-btn-block" disabled title="即將推出">
        ${svgIcon('export', 16)}一次匯出全書筆記
      </button>
      <div class="readflow-footer-row">
        <button class="readflow-btn readflow-btn-secondary" disabled title="即將推出">${svgIcon('mark', 15)}生字本</button>
        <button class="readflow-btn readflow-btn-secondary" disabled title="即將推出">${svgIcon('history', 15)}歷史</button>
        <span class="readflow-spacer"></span>
        <button class="readflow-btn readflow-btn-secondary" disabled title="即將推出">只匯出本段</button>
      </div>
    </div>
    ${settingsOverlayOpen ? renderSettingsOverlayHtml() : ''}
  `;
  applyBodyFontSize(bodyFontSize);
}

function rerenderCurrentView() {
  if (currentView === 'start') renderDrawerStart();
  else if (currentView === 'result') renderDrawerResult();
  // 'loading' and 'error' are transient and re-rendered by their own flows.
}

// ── Drawer-wide click/change dispatch ─────────────────────────────
// One delegated listener (attached once, in initDrawer) instead of
// re-wiring buttons after every innerHTML swap.
function onDrawerClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const scope = el.dataset.scope;

  if (action === 'start-capture') { onStartCapture(); return; }
  if (action === 'close-drawer') { setDrawerOpen(false); return; }
  if (action === 'error-back') { renderDrawerStart(); return; }
  if (action === 'reanalyze') { onStartCapture(); return; }

  if (action === 'open-settings') {
    settingsDraft = { level: panelLevel, pageCount: panelPageCount, currentPageOnly: panelCurrentPageOnly };
    settingsOverlayOpen = true;
    renderDrawerResult();
    return;
  }
  if (action === 'close-settings' || action === 'cancel-settings') {
    settingsOverlayOpen = false;
    renderDrawerResult();
    return;
  }
  if (action === 'save-settings') {
    const levelChanged = settingsDraft.level !== panelLevel;
    panelLevel = settingsDraft.level;
    panelPageCount = settingsDraft.pageCount;
    panelCurrentPageOnly = settingsDraft.currentPageOnly;
    settingsOverlayOpen = false;
    if (levelChanged) onStartCapture();
    else renderDrawerResult();
    return;
  }
  if (action === 'pick-level') {
    if (scope === 'start') { panelLevel = el.dataset.level; renderDrawerStart(); }
    else { settingsDraft.level = el.dataset.level; renderDrawerResult(); }
    return;
  }
  if (action === 'dec-pages' || action === 'inc-pages') {
    const delta = action === 'inc-pages' ? 1 : -1;
    if (scope === 'start') { panelPageCount = clampPageCount(panelPageCount + delta); renderDrawerStart(); }
    else { settingsDraft.pageCount = clampPageCount(settingsDraft.pageCount + delta); renderDrawerResult(); }
    return;
  }
  if (action === 'pick-tab') { resultTab = el.dataset.tab; renderDrawerResult(); return; }
  if (action === 'speak') { speakWord(el.dataset.word); return; }
  if (action === 'toggle-mark') { toggleMark(el.dataset.word); return; }
  if (action === 'toggle-grammar-mark') { toggleGrammarMark(el.dataset.frag); return; }
  if (action === 'font-dec') { applyBodyFontSize(bodyFontSize - 1); return; }
  if (action === 'font-inc') { applyBodyFontSize(bodyFontSize + 1); return; }
  if (action === 'apikey-edit-toggle') { apiKeyEditOpen = !apiKeyEditOpen; rerenderCurrentView(); return; }
  if (action === 'apikey-save') {
    const input = drawerBody.querySelector('#readflow-apikey-input');
    const value = input ? input.value.trim() : '';
    if (!value) return;
    chrome.storage.local.set({ [`${panelProvider}ApiKey`]: value }, () => {
      currentApiKey = value;
      apiKeyEditOpen = false;
      rerenderCurrentView();
    });
    return;
  }
}

function onDrawerChange(e) {
  const providerEl = e.target.closest('[data-action="pick-provider"]');
  if (providerEl) {
    panelProvider = providerEl.value;
    apiKeyEditOpen = false;
    chrome.storage.local.set({ provider: panelProvider });
    chrome.storage.local.get(['geminiApiKey', 'deepseekApiKey', 'apiKey'], (stored) => {
      currentApiKey = pickApiKeyForProvider(panelProvider, stored);
      rerenderCurrentView();
    });
    return;
  }

  const el = e.target.closest('[data-action="toggle-current-page"]');
  if (!el) return;
  const scope = el.dataset.scope;
  if (scope === 'start') { panelCurrentPageOnly = el.checked; renderDrawerStart(); }
  else { settingsDraft.currentPageOnly = el.checked; renderDrawerResult(); }
}

// ── Vocab card interactions ───────────────────────────────────────
function speakWord(word) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

// Reuses the existing highlight-in-book-text mechanism (toggleHighlightRequest,
// handled by applyHighlightToggle below in every frame) rather than inventing
// a separate "starred word" concept. markedWords here just mirrors what this
// frame has already asked reader frames to toggle, purely to drive the
// button's on/off style — no round-trip needed to know the current state.
function toggleMark(word) {
  const key = word.toLowerCase();
  if (markedWords.has(key)) markedWords.delete(key);
  else markedWords.add(key);
  broadcastToDescendantFrames(window, { source: 'readflow', type: 'toggleHighlightRequest', word });
  renderDrawerResult();
}

// Same reuse pattern as toggleMark, but underlines a grammar frag (a full
// quoted phrase) in the book text instead of highlighting a single word —
// distinct visual treatment (underline vs. background) because a full
// clause under a solid highlight reads as much heavier than a single word.
function toggleGrammarMark(frag) {
  const key = normalizeFragKey(frag);
  if (markedGrammar.has(key)) markedGrammar.delete(key);
  else markedGrammar.add(key);
  broadcastToDescendantFrames(window, { source: 'readflow', type: 'toggleGrammarMarkRequest', frag });
  renderDrawerResult();
}

// One-directional versions of toggleMark/toggleGrammarMark — "ensure
// marked" rather than "flip", so calling this for every vocab/grammar item
// on every completed analysis (autoMarkResult below) never un-marks
// something the user already turned on by hand.
function markWordOn(word) {
  const key = word.toLowerCase();
  if (markedWords.has(key)) return;
  markedWords.add(key);
  broadcastToDescendantFrames(window, { source: 'readflow', type: 'toggleHighlightRequest', word });
}

function markGrammarOn(frag) {
  const key = normalizeFragKey(frag);
  if (markedGrammar.has(key)) return;
  markedGrammar.add(key);
  broadcastToDescendantFrames(window, { source: 'readflow', type: 'toggleGrammarMarkRequest', frag });
}

// Proactively marks every vocab word and grammar frag from a finished
// analysis, so the user doesn't have to click 畫記 on each card by hand —
// called right after lastResult is set, before the first render of the
// result view, so the 畫記 buttons already render active.
function autoMarkResult(result) {
  result.vocab.forEach((v) => markWordOn(v.word));
  result.grammar.forEach((g) => markGrammarOn(g.frag));
}

// ── Capture flow ───────────────────────────────────────────────────
const CAPTURE_TIMEOUT_MS = 6000;
let captureTimeoutId = null;

function onStartCapture() {
  const pageCount = panelCurrentPageOnly ? 1 : panelPageCount;

  if (DEBUG_MODE) {
    runDebugCapture(pageCount);
    return;
  }

  renderDrawerLoading(0, pageCount);
  setDrawerOpen(true);
  broadcastToDescendantFrames(window, { source: 'readflow', type: 'startChapterCapture', pageCount });

  clearTimeout(captureTimeoutId);
  captureTimeoutId = setTimeout(() => {
    renderDrawerError('無法自動翻頁，請確認目前在書本閱讀頁面內，然後重新分析。');
    setDrawerOpen(true);
  }, CAPTURE_TIMEOUT_MS);
}

// ── Debug mode: local, fake capture + analysis ──────────────────────
// Runs entirely in the top frame — no broadcast, no real frames, no
// chrome.runtime — so the whole drawer flow works on any page.
const DEBUG_PAGES = [
  '(Debug page 1) The rain drummed steadily on the tin awning above the shop. She pushed open the door beneath a faded poster, and the little bell overhead gave a soft jingle. The shopkeeper glanced up at her, then dropped his gaze again, absorbed in the pile of secondhand books behind the counter.',
  "(Debug page 2) It was purely by chance that she stumbled upon the notebook, its cover worn and mottled with age. Tucked between the pages was a letter that had never been sent, the ink smudged by damp, and something about it left her with a lingering, wistful sadness.",
  "(Debug page 3) She folded the letter carefully and slipped it back where she had found it, though she couldn't bring herself to return the notebook to the shelf. Even though the rain outside showed no sign of letting up, she decided to stay a little longer and finish reading it.",
  '(Debug page 4) Toward the final pages, the handwriting suddenly grew neat and deliberate, as if someone else had taken over the writing. That passage mentioned an address she had never heard of, along with a date just three days away.',
  '(Debug page 5) "So, are you going to buy it?" the shopkeeper finally asked. She looked up, hesitated for a moment, then nodded. The bell rang once more — this time, as she pushed the door open to leave.',
];

const DEBUG_VOCAB = [
  { word: 'mottled', pos: 'adj.', zh: '表面帶有斑駁色塊、不均勻，這裡形容筆記本封面因年代久遠產生的痕跡，可理解為「舊舊髒髒、顏色不均」。', quote: '原文："its cover worn and mottled with age"' },
  { word: 'wistful', pos: 'adj.', zh: '帶著淡淡感傷與懷念、若有所失的心情，語氣比 sad 更含蓄。', quote: '原文："left her with a lingering, wistful sadness"' },
  { word: 'deliberate', pos: 'adj.', zh: '這裡指刻意、工整、經過用心書寫，不是「延遲」的意思。', quote: '原文："grew neat and deliberate"' },
];

const DEBUG_GRAMMAR = [
  { frag: 'as if someone else had taken over the writing', note: '`as if` 後面接過去完成式（had + p.p.），用來描述「其實未必是事實、只是看起來像」的假設情境，這種語氣在描述懷疑或推測時很常見。', rewrite: 'it looked like someone else had written it' },
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
    renderDrawerError('(Debug 模擬) 無法連線至 Gemini，請稍後再試');
    setDrawerOpen(true);
    return;
  }

  lastResult = {
    scene: '清晨的港口，船隻靜止停泊，主角例行清點船數，這是她每週自發的習慣。',
    points: [
      '敘事從環境寫到人物：先給靜止的港口，再帶出無人要求、也無人在意的清點行為。',
      '口袋裡的帳本快寫滿了，是這段唯一往前推的物件線索。',
      '在整體脈絡中屬於開場鋪陳，建立孤獨與規律，尚未進入衝突。',
      `（Debug）已擷取 ${pages.length} 頁內容。`,
    ],
    vocab: DEBUG_VOCAB,
    grammar: DEBUG_GRAMMAR,
  };
  lastMeta = {
    pageCount: pages.length,
    level: panelLevel,
    reachedEnd,
    usage: { promptTokenCount: 812, candidatesTokenCount: 356, totalTokenCount: 1168 },
    debug: true,
  };
  resultTab = 'outline';
  autoMarkResult(lastResult);
  renderDrawerResult();
  setDrawerOpen(true);
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

function updateLoadingProgress(current, total) {
  clearTimeout(captureTimeoutId);
  if (!drawerBody) return;
  renderDrawerLoading(current, total);
}

function onCaptureFinished(pages, reachedEnd) {
  clearTimeout(captureTimeoutId);
  chrome.storage.local.get(['geminiApiKey', 'deepseekApiKey', 'apiKey'], (stored) => {
    const apiKey = pickApiKeyForProvider(panelProvider, stored);
    if (!apiKey) {
      renderDrawerError(`尚未設定 ${providerLabel(panelProvider)} API Key，請在上方「設定」中新增。`);
      setDrawerOpen(true);
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'analyzeChapter', pages, apiKey, provider: panelProvider, level: panelLevel },
      (response) => {
        if (chrome.runtime.lastError || response?.error) {
          const msg = response?.error || chrome.runtime.lastError?.message;
          renderDrawerError(`Error: ${msg}`);
          setDrawerOpen(true);
          return;
        }
        try {
          lastResult = response.result;
          lastMeta = {
            pageCount: pages.length,
            level: panelLevel,
            reachedEnd,
            usage: response.usage,
            debug: false,
          };
          resultTab = 'outline';
          autoMarkResult(lastResult);
          renderDrawerResult();
          setDrawerOpen(true);
        } catch (e) {
          renderDrawerError('導讀結果格式錯誤，請重新分析。');
          setDrawerOpen(true);
        }
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
  if (data.type === 'toggleGrammarMarkRequest') applyGrammarMarkToggle(data.frag);
  if (data.type === 'extractPageTextRequest') {
    event.source.postMessage({
      source: 'readflow',
      type: 'extractPageTextResponse',
      requestId: data.requestId,
      text: extractLocalText(),
    }, '*');
  }
});

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

// Gemini gives vocab words in their dictionary/base form ("boat"), but the
// book text itself often contains an inflected form ("boats", "walked",
// "walking") — a strict \bword\b match can't find those (no word boundary
// exists between "t" and "s" in "boats"), so 畫記 silently highlights
// nothing even in the right frame. The optional suffix group is folded
// INTO the single capturing group (not left outside it) so
// `textNode.textContent.split(regex)` — which keeps only captured text —
// preserves the suffix in the split output instead of dropping it.
function buildWordRegex(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b(' + escaped + '(?:es|s|ed|d|ing)?)\\b', 'gi');
}

// A grammar `frag` is a multi-word phrase Gemini quotes from the original
// text, not a single dictionary word — matching it needs to tolerate the
// page reflowing that phrase across a line wrap (different whitespace
// between the same words). It also needs to tolerate something more than
// whitespace: for a long sentence, Gemini's own prompt lets it quote just
// the relevant part and skip the middle with "..." (confirmed live against
// a real book — a frag like "...institutional developments... have had
// enormous consequences." elides "sometimes based on very accidental
// circumstances," from the actual sentence). Each side of a "..."/"…" is
// still matched literally in order; only the gap between sides is a
// wildcard — this isn't a fuzzy/paraphrase match, just an elision-aware one.
function buildFragRegex(frag) {
  const normalized = frag.trim().replace(/\s+/g, ' ');
  const segments = normalized.split(/\s*(?:\.{3,}|…)\s*/).filter((seg) => seg.length > 0);
  const segmentPatterns = segments.map((seg) => {
    const tokens = seg.split(' ').map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return tokens.join('\\s+');
  });
  return new RegExp('\\b' + segmentPatterns.join('[\\s\\S]*?') + '\\b', 'gi');
}

// The lookup key for a frag, shared between the 畫記 button's active-state
// check (renderTabBody), toggleGrammarMark (top frame), and
// applyGrammarMarkToggle (reader frame) — must stay identical everywhere,
// or a frag marked in one place won't be recognized as marked in another.
function normalizeFragKey(frag) {
  return frag.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Cross-node text search & wrap ─────────────────────────────────
// Play Books (and paginated readers generally) commonly render each word or
// line in its own element for layout control, splitting one visual run of
// text into many DOM text nodes. A single vocab word usually still fits
// inside one such node, but a multi-word grammar frag almost never does —
// searching/splitting node-by-node (the old approach) simply never finds a
// match that crosses a node boundary. These three functions instead search
// the whole page's text as one concatenated string, then map a match's
// [start, end) offset back onto however many nodes it actually spans.

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

function findAllMatchRanges(regex, text) {
  const ranges = [];
  let m;
  while ((m = regex.exec(text))) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) regex.lastIndex++; // guard against a zero-length match looping forever
  }
  return ranges;
}

// Wraps each given [start, end) range of the concatenated text of `nodes`
// (in document order) with an element built by `makeWrapper(matchedText)`.
// Every range that touches a given node is applied in a single
// `replaceWith` per node — never one `replaceWith` per range — so two
// ranges landing in the same original node (e.g. a word appearing twice in
// one paragraph) don't fight over a node the first call already detached.
function wrapTextRanges(nodes, ranges, makeWrapper) {
  if (ranges.length === 0) return;
  let offset = 0;
  for (const node of nodes) {
    const nodeStart = offset;
    const text = node.textContent;
    const nodeEnd = nodeStart + text.length;
    offset = nodeEnd;

    const overlapping = ranges
      .filter((r) => r.end > nodeStart && r.start < nodeEnd)
      .sort((a, b) => a.start - b.start);
    if (overlapping.length === 0) continue;

    const domFrag = document.createDocumentFragment();
    let cursor = 0; // position within this node's own text, not the whole page
    overlapping.forEach((r) => {
      const localStart = Math.max(0, r.start - nodeStart);
      const localEnd = Math.min(text.length, r.end - nodeStart);
      if (localStart > cursor) domFrag.appendChild(document.createTextNode(text.slice(cursor, localStart)));
      domFrag.appendChild(makeWrapper(text.slice(localStart, localEnd)));
      cursor = localEnd;
    });
    if (cursor < text.length) domFrag.appendChild(document.createTextNode(text.slice(cursor)));
    node.replaceWith(domFrag);
  }
}

// Marks (or unmarks) every visible occurrence of `word` in this frame's
// body with a <mark>. Runs in every frame reached by
// broadcastToDescendantFrames; only the frame that actually has the
// word (in its base or inflected form) in its text will find anything to do.
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

  const nodes = collectTextNodes(document.body);
  const fullText = nodes.map((n) => n.textContent).join('');
  const ranges = findAllMatchRanges(buildWordRegex(word), fullText);
  if (ranges.length === 0) return; // not the right frame

  wrapTextRanges(nodes, ranges, (text) => {
    const mark = document.createElement('mark');
    mark.className = 'readflow-highlight';
    mark.dataset.word = key;
    mark.textContent = text;
    return mark;
  });
  highlightedWords.add(key);
}

// Same shape as applyHighlightToggle, but underlines a grammar frag (a
// multi-word phrase, matched via buildFragRegex) instead of highlighting a
// single vocab word. Wrapped in <u>, not <mark> — a solid background over a
// whole clause reads as much heavier than over one word, so grammar marks
// get the lighter underline treatment instead (see styles.css).
const grammarMarkedFrags = new Set();

function applyGrammarMarkToggle(frag) {
  const key = normalizeFragKey(frag);
  if (grammarMarkedFrags.has(key)) {
    document.querySelectorAll('u.readflow-grammar-mark[data-frag-key="' + CSS.escape(key) + '"]').forEach((u) => {
      u.replaceWith(document.createTextNode(u.textContent));
    });
    grammarMarkedFrags.delete(key);
    return;
  }

  const nodes = collectTextNodes(document.body);
  const fullText = nodes.map((n) => n.textContent).join('');
  const ranges = findAllMatchRanges(buildFragRegex(frag), fullText);
  if (ranges.length === 0) return; // not the right frame, or the frag doesn't appear literally

  wrapTextRanges(nodes, ranges, (text) => {
    const u = document.createElement('u');
    u.className = 'readflow-grammar-mark';
    u.dataset.fragKey = key;
    u.textContent = text;
    return u;
  });
  grammarMarkedFrags.add(key);
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

if (typeof module !== 'undefined') {
  module.exports = {
    clampPageCount, computeTabCounts, maskApiKey, escapeHtml, buildWordRegex, buildFragRegex,
    collectTextNodes, findAllMatchRanges, wrapTextRanges,
    providerLabel, pickApiKeyForProvider,
  };
}
