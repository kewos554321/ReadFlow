# Chapter Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile "select text → explain" tooltip feature with Chapter Guide: a persistent icon that auto-advances N pages, collects their text, and shows an outline + vocabulary + grammar briefing before the user reads that stretch.

**Architecture:** `content.js` runs in every frame (top `play.google.com` document, the `books.googleusercontent.com` iframe, and any nested sandboxed frame — `all_frames: true` + `match_origin_as_fallback: true` already set in manifest.json). All persistent UI (icon, input panel, result panel) lives **only** in the top frame (`window === window.top`), guarded by an element-existence check, so it never depends on iframe positioning or timing — this is what makes it more robust than the old feature. Only the page-turn + text-extraction loop runs inside the book-content frame, driven by `window.postMessage` from the top frame. `background.js` gets a second Gemini call path (`analyzeChapter`) alongside the request-body builder, fully unit-testable the same way the existing one is.

**Tech Stack:** Vanilla JS content script + MV3 service worker, Jest + jsdom for pure-function tests (existing project setup, no new dependencies).

**Spec:** [docs/superpowers/specs/2026-09-02-chapter-guide-design.md](../specs/2026-09-02-chapter-guide-design.md)

**Deviation from spec:** The spec's "Non-goals" section said to keep the select-and-explain feature unchanged. The user decided today (2026-09-07) to remove it entirely instead — it was the source of repeated cross-iframe positioning/injection bugs, and the user's actual goal was always chapter-level pre-reading, not word-level lookup. Task 1 below removes it.

## Global Constraints

- Output language: Traditional Chinese, same tone/format conventions as the existing prompt.
- Outline section must never reveal ending or key plot turns — scene/theme only.
- Total response should stay concise enough to skim on an E-Ink screen.
- `generationConfig.maxOutputTokens` for the chapter call is `1500` (per spec).
- Reuse the existing `fetch`-based call pattern in `background.js` — no new HTTP libraries.
- No new npm dependencies; keep using the existing Jest + jsdom setup.
- DOM/iframe-dependent code (page-turn simulation, cross-frame messaging, panel rendering) is not unit-tested in this project (confirmed existing convention — see spec's own Testing section) — validate those live in the Play Books reader instead.

---

## File Structure

- **`content.js`** (modify across Tasks 1, 4, 5, 6) — content script injected into every frame. Top-frame branch owns the icon/panels; the shared branch owns cross-frame messaging; the iframe branch owns page-turning.
- **`styles.css`** (modify across Tasks 1, 4, 6) — drop the old `.readflow-icon`/`.readflow-tooltip` rules, add `.readflow-page-icon`, `.readflow-input-panel`, `.readflow-panel`.
- **`background.js`** (modify in Tasks 1, 3) — drop the old `lookup` handler, add the `analyzeChapter` handler.
- **`lib/extractContext.js`** (delete in Task 1) — only used by the removed feature.
- **`lib/joinPageTexts.js`** (create in Task 2) — new pure helper, unit-tested, later inlined into `background.js`.
- **`tests/extractContext.test.js`** (delete in Task 1).
- **`tests/background.test.js`** (replaced in Tasks 1 + 3) — old tests removed, new chapter-backend tests added.
- **`tests/joinPageTexts.test.js`** (create in Task 2).

---

### Task 1: Remove the legacy select-and-explain feature

**Files:**
- Modify: `content.js`
- Modify: `styles.css`
- Modify: `background.js`
- Delete: `lib/extractContext.js`
- Delete: `tests/extractContext.test.js`
- Modify: `tests/background.test.js`

**Interfaces:**
- Produces: a minimal `content.js` (just the load log) and `background.js` with no message listener yet — later tasks add onto this clean base.

- [ ] **Step 1: Replace `content.js` with the minimal base**

Replace the entire file with:

```js
console.log('[ReadFlow] loaded in:', window.location.href);
```

- [ ] **Step 2: Empty out `styles.css`**

Replace the entire file with a single comment line (keeps the file present since manifest.json references it):

```css
/* ReadFlow styles */
```

- [ ] **Step 3: Strip `background.js` down to nothing but the module boilerplate**

Replace the entire file with:

```js
if (typeof module !== 'undefined') {
  module.exports = {};
}
```

- [ ] **Step 4: Delete the now-unused selection-context helper and its test**

```bash
rm lib/extractContext.js tests/extractContext.test.js
```

- [ ] **Step 5: Delete the old background tests (will be rewritten in Task 3)**

```bash
rm tests/background.test.js
```

- [ ] **Step 6: Run the full suite to confirm the remaining tests still pass**

Run: `npm test`
Expected: 2 suites pass (`renderMarkdown.test.js`, `popup.test.js`), 0 failures.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove select-and-explain feature to make way for Chapter Guide"
```

---

### Task 2: `joinPageTexts` pure helper

**Files:**
- Create: `lib/joinPageTexts.js`
- Test: `tests/joinPageTexts.test.js`

**Interfaces:**
- Produces: `joinPageTexts(pages: string[]): string` — joins non-blank pages with a `\n\n---\n\n` separator. Consumed by `background.js` in Task 3 (as an inlined copy, matching how `content.js` inlines `lib/renderMarkdown.js` today).

- [ ] **Step 1: Write the failing tests**

```js
const { joinPageTexts } = require('../lib/joinPageTexts.js');

test('joins multiple pages with a separator', () => {
  const result = joinPageTexts(['Page one text.', 'Page two text.']);
  expect(result).toBe('Page one text.\n\n---\n\nPage two text.');
});

test('skips empty or whitespace-only pages', () => {
  const result = joinPageTexts(['Page one.', '   ', '', 'Page two.']);
  expect(result).toBe('Page one.\n\n---\n\nPage two.');
});

test('returns empty string for an empty array', () => {
  expect(joinPageTexts([])).toBe('');
});
```

Save as `tests/joinPageTexts.test.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/joinPageTexts.test.js`
Expected: FAIL with "Cannot find module '../lib/joinPageTexts.js'"

- [ ] **Step 3: Write the implementation**

```js
function joinPageTexts(pages) {
  return pages.filter((p) => p && p.trim()).join('\n\n---\n\n');
}

if (typeof module !== 'undefined') {
  module.exports = { joinPageTexts };
}
```

Save as `lib/joinPageTexts.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/joinPageTexts.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/joinPageTexts.js tests/joinPageTexts.test.js
git commit -m "feat: add joinPageTexts helper for Chapter Guide"
```

---

### Task 3: Chapter Guide backend in `background.js`

**Files:**
- Modify: `background.js`
- Test: `tests/background.test.js` (recreate)

**Interfaces:**
- Consumes: nothing new (uses the same `fetch` global as before).
- Produces: `buildChapterRequestBody(pages: string[]): object`, `callGeminiForChapter(apiKey: string, pages: string[]): Promise<string>`, and a `chrome.runtime.onMessage` handler for `message.type === 'analyzeChapter'` expecting `{ pages, apiKey }` and responding with `{ result }` or `{ error }`. Consumed by `content.js` in Task 6 via `chrome.runtime.sendMessage({ type: 'analyzeChapter', pages, apiKey }, callback)`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/background.test.js` with:

```js
const { buildChapterRequestBody, callGeminiForChapter, joinPageTexts } = require('../background.js');

test('joinPageTexts joins pages with a separator and skips blanks', () => {
  expect(joinPageTexts(['Page one.', '  ', 'Page two.'])).toBe('Page one.\n\n---\n\nPage two.');
});

test('buildChapterRequestBody puts joined page text in the user content', () => {
  const body = buildChapterRequestBody(['Once upon a time.', 'The end.']);
  expect(body.contents).toEqual([{
    role: 'user',
    parts: [{ text: 'Once upon a time.\n\n---\n\nThe end.' }]
  }]);
  expect(body.system_instruction.parts[0].text).toContain('導讀');
  expect(body.generationConfig.maxOutputTokens).toBe(1500);
});

test('buildChapterRequestBody truncates very long page text', () => {
  const longPage = 'a'.repeat(30000);
  const body = buildChapterRequestBody([longPage]);
  expect(body.contents[0].parts[0].text.length).toBe(20000);
});

test('callGeminiForChapter calls Gemini endpoint and returns text', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: '**章節大綱**' }] } }]
    })
  });

  const result = await callGeminiForChapter('AIza-test', ['Some chapter text.']);

  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('AIza-test'),
    expect.objectContaining({ method: 'POST' })
  );
  expect(result).toBe('**章節大綱**');
});

test('callGeminiForChapter throws on API error', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: 'Invalid API key' } })
  });

  await expect(
    callGeminiForChapter('bad-key', ['text'])
  ).rejects.toThrow('Invalid API key');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/background.test.js`
Expected: FAIL — `buildChapterRequestBody is not a function` (background.js currently exports `{}`)

- [ ] **Step 3: Implement in `background.js`**

Replace the entire file with:

```js
const GEMINI_MODEL = 'gemini-3.6-flash';

const CHAPTER_SYSTEM_PROMPT = `# Role
你是一位精通第二語言習得（SLA）與英文閱讀輔助的專業導師。

# Task
讀者即將閱讀以下這段內容（可能橫跨多頁），請在他們開始細讀前，
提供一份「導讀」，幫助他們掌握大綱並提前認識可能造成閱讀障礙的
生字與文法。

# Constraints
1. 大綱部分嚴禁劇透結局或關鍵轉折，只描述場景/主題，不描述結果。
2. 生字與文法各挑選對 B1-B2 程度讀者最有幫助的重點，不需窮舉。
3. 輸出必須簡潔，適合在 E-Ink 螢幕上快速瀏覽。

# Output Format（請嚴格保持以下 Markdown 格式）

**📖 章節大綱 (Outline)**
* 2-4 句話說明這段內容的場景、主題或涉及的人物/事件範圍。

**📚 困難生字 (Difficult Vocabulary)**
* **[單字]**：在此語境下的意思（附白話解釋）。

**📝 困難文法 (Difficult Grammar)**
* \`[原文片段]\`：說明句構或時態為何值得注意。`;

const CHAPTER_TEXT_CHAR_CAP = 20000;

function joinPageTexts(pages) {
  return pages.filter((p) => p && p.trim()).join('\n\n---\n\n');
}

function buildChapterRequestBody(pages) {
  const joined = joinPageTexts(pages).slice(0, CHAPTER_TEXT_CHAR_CAP);
  return {
    system_instruction: {
      parts: [{ text: CHAPTER_SYSTEM_PROMPT }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: joined }]
    }],
    generationConfig: { maxOutputTokens: 1500 }
  };
}

async function callGeminiForChapter(apiKey, pages) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildChapterRequestBody(pages)),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'API request failed');
  }
  return data.candidates[0].content.parts[0].text;
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'analyzeChapter') return false;
    const { pages, apiKey } = message;
    callGeminiForChapter(apiKey, pages)
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  });
}

if (typeof module !== 'undefined') {
  module.exports = { joinPageTexts, buildChapterRequestBody, callGeminiForChapter };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/background.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: 3 suites pass (`background`, `renderMarkdown`, `popup`)

- [ ] **Step 6: Commit**

```bash
git add background.js tests/background.test.js
git commit -m "feat: add Chapter Guide Gemini backend (analyzeChapter)"
```

---

### Task 4: Persistent page icon + page-count input panel (top frame)

**Files:**
- Modify: `content.js`
- Modify: `styles.css`

**Interfaces:**
- Produces: `#readflow-page-icon` element (top frame only), `.readflow-input-panel` with a `#readflow-page-count` number input and `#readflow-start-capture` button. `onStartCapture()` is a stub in this task (logs to console) — Task 6 replaces its body with the real wiring, so its name/signature (`function onStartCapture()`, no args) must stay stable for that later diff to apply cleanly.

- [ ] **Step 1: Add the top-frame icon + panel to `content.js`**

Append to the end of `content.js`:

```js

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
```

- [ ] **Step 2: Add the icon + panel styles to `styles.css`**

Replace the file's contents with:

```css
/* ReadFlow styles */

.readflow-page-icon {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  background: #1a73e8;
  color: white;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  user-select: none;
  transition: transform 0.1s, background 0.1s;
}

.readflow-page-icon:hover {
  background: #1558b0;
  transform: scale(1.1);
}

.readflow-input-panel {
  position: fixed;
  right: 16px;
  bottom: 64px;
  z-index: 2147483647;
  background: #1e1e2e;
  color: #cdd6f4;
  border-radius: 10px;
  padding: 12px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.readflow-input-panel label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.readflow-input-panel input {
  width: 56px;
  padding: 4px 6px;
  border-radius: 4px;
  border: none;
}

.readflow-input-panel button {
  background: #1a73e8;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
}

.readflow-input-panel button:hover { background: #1558b0; }
```

- [ ] **Step 3: Run the full test suite (should be unaffected — this task has no unit tests, per Global Constraints)**

Run: `npm test`
Expected: 3 suites pass, same as after Task 3.

- [ ] **Step 4: Manual visual check**

In `chrome://extensions`, reload ReadFlow. Open any book in the Play Books reader.
Expected:
- A blue circular 📖 icon fixed at the bottom-right of the viewport.
- Clicking it opens a dark panel above it with a number input (default `10`) and a "開始分析" button.
- Clicking the icon again, or reopening, toggles the panel closed/open.
- Clicking "開始分析" logs `[ReadFlow] Chapter Guide requested, pageCount = <n>` in the console and closes the panel (no other effect yet — expected until Task 6).

- [ ] **Step 5: Commit**

```bash
git add content.js styles.css
git commit -m "feat: add Chapter Guide persistent icon and page-count panel"
```

---

### Task 5: Iframe-side page-turn & text-collection loop

**Files:**
- Modify: `content.js`

**Interfaces:**
- Consumes: nothing from other tasks directly — this is a self-contained message handler.
- Produces: a `window.addEventListener('message', ...)` handler (shared across all frames) that reacts to `{ source: 'readflow', type: 'startChapterCapture', pageCount }` by running `runChapterCapture(pageCount)` in whichever frame actually has `.forward-gutter` in its own document, then posts `{ source: 'readflow', type: 'chapterCaptureProgress', current, total }` (repeatedly) and finally `{ source: 'readflow', type: 'chapterCaptureResult', pages, reachedEnd }` to `window.top`. Task 6 posts the triggering message and listens for these two result types.

**Note on the biggest open risk (per spec):** whether a synthetic `.click()` on `.forward-gutter` actually advances the page is unverified — Play Books' page-turn is driven by an Angular/RxJS pipeline that may ignore untrusted synthetic clicks. If manual testing in Step 4 below shows pages aren't turning, change `clickForward`/`clickBackward` to dispatch a keyboard event instead:

```js
function dispatchArrowKey(key) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}
```
and call `dispatchArrowKey('ArrowRight')` / `dispatchArrowKey('ArrowLeft')` in place of the `.click()` calls.

- [ ] **Step 1: Add the cross-frame message listener and capture loop to `content.js`**

Append to the end of `content.js`:

```js

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
```

Note: `updateLoadingProgress` and `onCaptureFinished` are referenced here but defined in Task 6 — this is expected; Task 6 must land before this code path is exercised end-to-end, but this task's own manual check (Step 4) only exercises the capture loop in the content frame, not those two top-frame functions.

- [ ] **Step 2: Run the full test suite (unaffected — no unit tests for this task, per Global Constraints)**

Run: `npm test`
Expected: 3 suites pass.

- [ ] **Step 3: Temporary manual trigger for isolated testing**

Since Task 6 hasn't wired the button yet, trigger this task's code directly from DevTools for isolated verification: open the book-content iframe's console context (DevTools → context dropdown → pick the `books.googleusercontent.com` frame) and run:

```js
window.postMessage({ source: 'readflow', type: 'startChapterCapture', pageCount: 3 }, '*');
```

- [ ] **Step 4: Manual live verification in Play Books**

Reload the extension, open a book, run the Step 3 snippet in the correct frame context.
Expected:
- The book visibly turns forward 3 pages, then back 3 pages, landing back where it started.
- If pages do NOT turn: apply the keyboard-event fallback described above, then retest.
- In the top frame's console, confirm a final message arrived (add a temporary `console.log('[ReadFlow] got', event.data)` inside the message listener if needed to check, then remove it before committing).

- [ ] **Step 5: Commit**

```bash
git add content.js
git commit -m "feat: add Chapter Guide page-turn and text-collection loop"
```

---

### Task 6: Top-frame wiring — trigger capture, show progress, render result

**Files:**
- Modify: `content.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `chrome.runtime.sendMessage({ type: 'analyzeChapter', pages, apiKey }, callback)` from Task 3; the `chapterCaptureProgress`/`chapterCaptureResult` message shapes from Task 5.
- Produces: the real `onStartCapture()` body (replacing Task 4's stub) and a `.readflow-panel` result panel using `renderMarkdown()`.

- [ ] **Step 1: Add the inlined `renderMarkdown` back to `content.js`**

Insert right after the `console.log('[ReadFlow] loaded in:', ...)` line at the top of `content.js`:

```js

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
```

- [ ] **Step 2: Replace the `onStartCapture` stub from Task 4**

Find this block (added in Task 4):

```js
function onStartCapture() {
  const input = document.getElementById('readflow-page-count');
  const pageCount = Math.max(1, parseInt(input.value, 10) || 10);
  closeInputPanel();
  console.log('[ReadFlow] Chapter Guide requested, pageCount =', pageCount);
}
```

Replace it with:

```js
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
      <button class="readflow-panel-close">×</button>
      <div class="readflow-panel-body"></div>
    `;
    resultPanel.querySelector('.readflow-panel-close').addEventListener('click', closeResultPanel);
    document.body.appendChild(resultPanel);
  }
  resultPanel.querySelector('.readflow-panel-body').innerHTML = html;
}

function closeResultPanel() {
  if (resultPanel) { resultPanel.remove(); resultPanel = null; }
}

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
        showResultPanel(note + renderMarkdown(response.result));
      }
    );
  });
}
```

Note: `updateLoadingProgress` and `onCaptureFinished` were already referenced (forward-declared) by Task 5's message listener — this step provides their real bodies, replacing nothing there.

- [ ] **Step 3: Add the result-panel styles to `styles.css`**

Append to the end of `styles.css`:

```css

.readflow-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  z-index: 2147483647;
  background: #1e1e2e;
  color: #cdd6f4;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.4);
  padding: 20px 16px;
  overflow-y: auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.7;
}

.readflow-panel-close {
  position: absolute;
  top: 8px;
  right: 12px;
  background: none;
  border: none;
  color: #cdd6f4;
  font-size: 20px;
  cursor: pointer;
}

.readflow-panel strong { color: #89b4fa; }

.readflow-panel code {
  background: #313244;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 13px;
  color: #f9e2af;
}

.readflow-panel ul { margin: 4px 0; padding-left: 16px; }
.readflow-panel li { margin: 2px 0; }
.readflow-panel em { color: #a6e3a1; font-style: italic; }
.readflow-note { color: #f9e2af; font-size: 12px; margin-bottom: 8px; }
.readflow-loading { color: #89b4fa; font-style: italic; }
.readflow-error { color: #f38ba8; }
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: 3 suites pass, unchanged from Task 3 (this task adds no new unit tests, per Global Constraints).

- [ ] **Step 5: Manual end-to-end verification**

Reload the extension, open a book with an API key already configured (via the popup).
1. Click the 📖 icon, set page count to `3`, click "開始分析".
2. Expected: panel shows "正在翻頁擷取內容 (0/3)", updates as pages turn, book visibly turns forward 3 pages then back 3.
3. Expected: panel then shows the rendered result with 📖 章節大綱 / 📚 困難生字 / 📝 困難文法 sections.
4. Click the × button — panel closes.
5. Test the no-API-key path (clear it via the popup first) — panel should show the "No API key" error text instead.

- [ ] **Step 6: Commit**

```bash
git add content.js styles.css
git commit -m "feat: wire Chapter Guide capture flow to Gemini and result panel"
```

---

## Self-Review

**Spec coverage:**
- Component 1 (persistent icon, top frame only, existence-check guarded) → Task 4. ✓
- Component 2 (page-count input panel) → Task 4. ✓
- Component 3 (auto page-turn + text collector, iframe) → Task 5. ✓
- Component 4 (cross-frame messaging contract) → Task 5 (listener) + Task 6 (sender). ✓
- Component 5 (`callGeminiForChapter`, new prompt, `maxOutputTokens: 1500`) → Task 3. ✓
- Component 6 (result panel reusing `renderMarkdown`) → Task 6. ✓
- Error handling (no API key, page-turn failure noted via `reachedEnd`, Gemini error) → Task 6. ✓
- "Keep existing feature unchanged" non-goal → explicitly overridden per the "Deviation from spec" note; Task 1 removes it instead, per today's user decision.
- Testing section (unit-test the request-body builder + a text-aggregation helper; validate DOM/iframe pieces live) → Tasks 2, 3 (unit), Tasks 4, 5, 6 (manual). ✓

**Placeholder scan:** No TBD/TODO markers; every step has literal code and literal shell commands.

**Type consistency:** `pages` is always `string[]` from Task 5's `runChapterCapture` through to Task 3's `buildChapterRequestBody`. `pageCount` is always a positive integer parsed once in `onStartCapture` (Task 4/6) and passed through unchanged. Function names introduced in one task (`onStartCapture`, `updateLoadingProgress`, `onCaptureFinished`, `handleStartChapterCapture`) are reused with identical signatures by the tasks that call them.
