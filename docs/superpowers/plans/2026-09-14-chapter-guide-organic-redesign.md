# Chapter Guide — Organic Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the ReadFlow Chapter Guide drawer to the "Organic" design system (direction 1a — 暖色卡片側欄) and restructure its result into 大綱/生字/文法 tabs backed by structured Gemini JSON output, with a settings panel (level, page count, API key), TTS, and word-marking.

**Architecture:** `background.js` switches its Gemini call from free-text markdown to schema-constrained JSON (`{scene, points[], vocab[], grammar[]}`), parameterized by a `level`. `styles.css` is fully replaced with Organic design tokens and new component classes. `content.js` keeps its existing capture/cross-frame/resize mechanics untouched and gets a new state + rendering layer: a start state (inline settings), a loading state, a result state (header + tabs + footer), and a settings overlay — all built from small pure helpers that are unit-tested, with the DOM wiring itself verified via the existing manual-test harness (this project's established pattern — `content.js` has no other DOM-level tests today).

**Tech Stack:** Vanilla JS content script (no build step, no imports — each file inlines what it needs and only shares data via `chrome.storage.local` / `chrome.runtime.sendMessage`), Jest + jsdom for unit tests, plain CSS custom properties for the design system.

**Spec:** [docs/superpowers/specs/2026-09-14-chapter-guide-organic-redesign.md](../specs/2026-09-14-chapter-guide-organic-redesign.md)

## Global Constraints

- No build step, no bundler, no ES module imports between `content.js` / `background.js` / `popup.js` — each file is self-contained and shares state only via `chrome.storage.local` or messages. Follow the existing `if (typeof module !== 'undefined') { module.exports = {...} }` pattern for testability.
- Design tokens are custom properties prefixed `--rf-*` (not the raw export's `--color-*`/`--space-*`/etc.) to avoid colliding with anything else on `play.google.com`.
- Fonts load via `@import url('https://fonts.googleapis.com/css2?family=Caprasimo...&family=Figtree...')` — verified safe against `play.google.com/books`'s CSP (`script-src` only, no `style-src`/`font-src`/`default-src`). No self-hosting.
- Icons are inline SVGs (Lucide paths, `stroke-width: 2.75`), copied from the mockup — no icon library dependency.
- Direction 1a only. No dark mode / `prefers-color-scheme` handling (Organic is a single warm-light palette by design).
- "一次匯出全書筆記" / "只匯出本段" / "歷史" render **disabled**, `title="即將推出"` — no storage/export work in this pass.
- Real page-number ranges are not shown (Play Books exposes no page numbers) — only a page **count**.
- All dynamic text interpolated into `innerHTML` (Gemini output, user-typed API keys) MUST go through an `escapeHtml()` helper — Gemini's output is untrusted content.
- Existing features not present in the mockup are preserved, integrated into the new chrome rather than dropped: "只掃描目前頁面" (current-page-only capture) and the A－/A＋ panel-text font-size controls.

---

## Task 1: `background.js` — structured JSON output with a `level` parameter

**Files:**
- Modify: `background.js` (full-file rewrite)
- Test: `tests/background.test.js` (full-file rewrite)

**Interfaces:**
- Produces: `buildChapterSystemPrompt(level)` → `string`; `buildChapterRequestBody(pages, level)` → request body object with `generationConfig.responseMimeType` / `responseSchema`; `callGeminiForChapter(apiKey, pages, level)` → `Promise<{ result: {scene, points, vocab, grammar}, usage }>`; `CHAPTER_RESPONSE_SCHEMA` (exported for tests/inspection). The `chrome.runtime.onMessage` listener for `'analyzeChapter'` now reads `message.level` and responds with `{ result, usage }` (an object, not markdown text) or `{ error }`.

- [ ] **Step 1: Write the new failing tests**

Replace `tests/background.test.js` entirely:

```js
const {
  buildChapterRequestBody,
  callGeminiForChapter,
  joinPageTexts,
  buildChapterSystemPrompt,
} = require('../background.js');

test('joinPageTexts joins pages with a separator and skips blanks', () => {
  expect(joinPageTexts(['Page one.', '  ', 'Page two.'])).toBe('Page one.\n\n---\n\nPage two.');
});

test('buildChapterRequestBody puts joined page text in the user content', () => {
  const body = buildChapterRequestBody(['Once upon a time.', 'The end.'], 'B2');
  expect(body.contents).toEqual([{
    role: 'user',
    parts: [{ text: 'Once upon a time.\n\n---\n\nThe end.' }]
  }]);
  expect(body.system_instruction.parts[0].text).toContain('導讀');
  expect(body.generationConfig.maxOutputTokens).toBe(2200);
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.responseSchema).toBeDefined();
});

test('buildChapterRequestBody truncates very long page text', () => {
  const longPage = 'a'.repeat(30000);
  const body = buildChapterRequestBody([longPage], 'B2');
  expect(body.contents[0].parts[0].text.length).toBe(20000);
});

test('buildChapterSystemPrompt interpolates the requested level', () => {
  expect(buildChapterSystemPrompt('C1')).toContain('C1（進階）');
  expect(buildChapterSystemPrompt('B1')).toContain('B1（基礎）');
  expect(buildChapterSystemPrompt(undefined)).toContain('B1-B2（中階）');
});

test('callGeminiForChapter calls Gemini endpoint and returns parsed JSON with usage', async () => {
  const fakeResult = { scene: '場景', points: ['重點一'], vocab: [], grammar: [] };
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(fakeResult) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 }
    })
  });

  const result = await callGeminiForChapter('AIza-test', ['Some chapter text.'], 'B2');

  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('AIza-test'),
    expect.objectContaining({ method: 'POST' })
  );
  expect(result.result).toEqual(fakeResult);
  expect(result.usage).toEqual({ promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 });
});

test('callGeminiForChapter throws on API error', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ error: { message: 'Invalid API key' } })
  });

  await expect(
    callGeminiForChapter('bad-key', ['text'], 'B2')
  ).rejects.toThrow('Invalid API key');
});

test('callGeminiForChapter throws a friendly error when the model returns invalid JSON', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'not json' }] } }],
      usageMetadata: null,
    })
  });

  await expect(
    callGeminiForChapter('AIza-test', ['text'], 'B2')
  ).rejects.toThrow('無法解析導讀結果');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/background.test.js`
Expected: FAIL — `buildChapterSystemPrompt is not a function` (doesn't exist yet), and the other assertions fail against the current markdown-based implementation.

- [ ] **Step 3: Rewrite `background.js`**

```js
const GEMINI_MODEL = 'gemini-3.6-flash';

const LEVEL_LABELS = {
  B1: 'B1（基礎）',
  B2: 'B1-B2（中階）',
  C1: 'C1（進階）',
};

function buildChapterSystemPrompt(level) {
  const label = LEVEL_LABELS[level] || LEVEL_LABELS.B2;
  return `# Role
你是一位精通第二語言習得（SLA）與英文閱讀輔助的專業導師。

# Task
讀者即將閱讀以下這段內容（可能橫跨多頁），請在他們開始細讀前，
提供一份「深入導讀」，幫助他們掌握大綱，並提前掌握可能造成閱讀
障礙的生字與文法——內容需要有足夠的細節與例子，不能只用一句話
籠統帶過。

# Constraints
1. scene／points 嚴禁劇透結局或關鍵轉折，只描述場景/主題，不描述結果。
2. vocab 與 grammar 各挑選對 ${label} 程度讀者最有幫助的 3-5 個重點，
   但每個項目都要有足夠深度：不能只給一個中文翻譯就結束。
3. 輸出雖然要有深度，但仍須保持精簡有重點，避免無意義的重複贅字，
   適合在小螢幕上快速瀏覽。

# Output Format
嚴格輸出符合 responseSchema 的 JSON，不要輸出任何 JSON 以外的文字：
- scene：1-2 句話說明這段內容的場景與主題。
- points：3-4 條字串，每條說明人物/論點，以及這段內容在整體脈絡中
  的作用（例如：是開場鋪陳、論證的轉折，還是案例佐證）。
- vocab：3-5 個項目，每個項目含 word（單字原形）、pos（詞性，例如
  "n." "adj." "v."）、zh（中文解釋，適合 ${label} 程度）、quote（引用
  原文例句或改寫成更簡單的說法，說明這個字實際上是怎麼被使用的）。
- grammar：3-5 個項目，每個項目含 frag（原文關鍵片段）、note（詳細
  說明句構或時態為何值得注意，可以怎麼拆解理解）、rewrite（更口語化
  的改寫版本）。`;
}

const CHAPTER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    scene: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
    vocab: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          pos: { type: 'string' },
          zh: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['word', 'pos', 'zh', 'quote'],
      },
    },
    grammar: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          frag: { type: 'string' },
          note: { type: 'string' },
          rewrite: { type: 'string' },
        },
        required: ['frag', 'note', 'rewrite'],
      },
    },
  },
  required: ['scene', 'points', 'vocab', 'grammar'],
};

const CHAPTER_TEXT_CHAR_CAP = 20000;

function joinPageTexts(pages) {
  return pages.filter((p) => p && p.trim()).join('\n\n---\n\n');
}

function buildChapterRequestBody(pages, level) {
  const joined = joinPageTexts(pages).slice(0, CHAPTER_TEXT_CHAR_CAP);
  return {
    system_instruction: {
      parts: [{ text: buildChapterSystemPrompt(level) }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: joined }]
    }],
    generationConfig: {
      maxOutputTokens: 2200,
      responseMimeType: 'application/json',
      responseSchema: CHAPTER_RESPONSE_SCHEMA,
    }
  };
}

async function callGeminiForChapter(apiKey, pages, level) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildChapterRequestBody(pages, level)),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'API request failed');
  }

  const rawText = data.candidates[0].content.parts[0].text;
  let result;
  try {
    result = JSON.parse(rawText);
  } catch (e) {
    throw new Error('無法解析導讀結果，請重新分析');
  }

  return {
    result,
    usage: data.usageMetadata || null,
  };
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'analyzeChapter') return false;
    const { pages, apiKey, level } = message;
    callGeminiForChapter(apiKey, pages, level)
      .then(({ result, usage }) => sendResponse({ result, usage }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    joinPageTexts,
    buildChapterRequestBody,
    callGeminiForChapter,
    buildChapterSystemPrompt,
    CHAPTER_RESPONSE_SCHEMA,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/background.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add background.js tests/background.test.js
git commit -m "$(cat <<'EOF'
feat: switch Chapter Guide analysis to structured JSON output

Gemini now returns {scene, points, vocab, grammar} via responseSchema
instead of a markdown blob, parameterized by a reading level. Lays
the groundwork for the Organic-redesign tabbed result view.
EOF
)"
```

---

## Task 2: `styles.css` — Organic design system

**Files:**
- Modify: `styles.css` (full-file rewrite)

**Interfaces:**
- Produces: the full set of `--rf-*` custom properties and `.readflow-*` component classes that Task 3's `content.js` rendering code targets (listed in Task 3's "Consumes" below). No JS/test interface — this is pure CSS.

- [ ] **Step 1: Replace `styles.css` in full**

```css
/* ReadFlow — Organic redesign (design 1a, 暖色卡片側欄) */

@import url('https://fonts.googleapis.com/css2?family=Caprasimo:wght@400&family=Figtree:wght@400;600;700&display=swap');

:root {
  --rf-bg: #f5ead8;
  --rf-surface: #ebddc5;
  --rf-text: #201e1d;
  --rf-accent: #c67139;
  --rf-accent-2: #7a8a5e;
  --rf-divider: color-mix(in srgb, #201e1d 16%, transparent);

  --rf-neutral-100: #f9f4ed;
  --rf-neutral-200: #eee7db;
  --rf-neutral-300: #dcd3c4;
  --rf-neutral-600: #82796a;
  --rf-neutral-700: #645c50;

  --rf-accent-100: #fff2eb;
  --rf-accent-200: #ffe1d0;
  --rf-accent-300: #ffc6a5;
  --rf-accent-600: #b2622d;
  --rf-accent-700: #8c491a;
  --rf-accent-800: #643312;

  --rf-accent2-100: #f0fae1;
  --rf-accent2-200: #e1eecc;
  --rf-accent2-600: #728157;
  --rf-accent2-700: #56633f;

  --rf-font-heading: "Caprasimo", system-ui, sans-serif;
  --rf-font-body: "Figtree", system-ui, sans-serif;

  --rf-space-1: 4.4px;
  --rf-space-2: 8.8px;
  --rf-space-3: 13.2px;
  --rf-space-4: 17.6px;
  --rf-space-6: 26.4px;

  --rf-radius-sm: 8px;
  --rf-radius-md: 16px;
  --rf-radius-lg: 28px;

  --rf-shadow-sm: 0 1px 2px color-mix(in srgb, #2e2b25 14%, transparent);
  --rf-shadow-md: 0 3px 10px color-mix(in srgb, #2e2b25 16%, transparent);
  --rf-shadow-lg: 0 12px 32px color-mix(in srgb, #2e2b25 22%, transparent);
}

/* — edge tab — */
.readflow-drawer-tab {
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  z-index: 2147483645;
  background: var(--rf-accent);
  color: var(--rf-bg);
  writing-mode: vertical-rl;
  text-orientation: mixed;
  min-width: 40px;
  padding: 18px 10px;
  border-radius: 999px 0 0 999px;
  cursor: pointer;
  font-family: var(--rf-font-heading);
  font-size: 14px;
  letter-spacing: 2px;
  box-shadow: -2px 2px 10px color-mix(in srgb, #2e2b25 30%, transparent);
  user-select: none;
  transition: right 0.25s ease, background 0.15s, box-shadow 0.15s;
}
.readflow-drawer-tab:hover { background: var(--rf-accent-600); }
.readflow-drawer-tab.open { box-shadow: none; }
.readflow-drawer-tab.resizing { transition: none; }
.readflow-drawer-tab:focus-visible { outline: 2px solid var(--rf-accent-800); outline-offset: 2px; }

/* — panel shell — */
.readflow-panel {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 360px;
  box-sizing: border-box;
  z-index: 2147483646;
  background: var(--rf-bg);
  color: var(--rf-text);
  box-shadow: -8px 0 28px color-mix(in srgb, #2e2b25 18%, transparent);
  display: flex;
  flex-direction: column;
  font-family: var(--rf-font-body);
  font-size: 14.5px;
  line-height: 1.6;
  transform: translateX(100%);
  transition: transform 0.25s ease;
  overflow: hidden;
}
.readflow-panel.open { transform: translateX(0); }
.readflow-panel * { box-sizing: border-box; }

.readflow-panel-resize-handle {
  position: fixed;
  top: 0; bottom: 0;
  width: 6px;
  cursor: ew-resize;
  touch-action: none;
  z-index: 2147483647;
  display: none;
}
.readflow-panel-resize-handle.open { display: block; }
.readflow-panel-resize-handle:hover,
.readflow-panel-resize-handle.dragging { background: color-mix(in srgb, var(--rf-accent) 35%, transparent); }

/* — header (start / loading / result / error all use this) — */
.readflow-header {
  padding: var(--rf-space-4) var(--rf-space-4) var(--rf-space-3);
  display: flex; flex-direction: column; gap: var(--rf-space-3);
  border-bottom: 1px solid var(--rf-divider);
  flex: none;
}
.readflow-header-row { display: flex; align-items: center; gap: var(--rf-space-2); }
.readflow-header-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 999px;
  background: var(--rf-accent-200); color: var(--rf-accent-700); flex: none;
}
.readflow-header-title { flex: 1; min-width: 0; }
.readflow-header-title h2 {
  font: 400 20px/1.1 var(--rf-font-heading); letter-spacing: -0.015em; margin: 0;
}
.readflow-header-meta { font-size: 12px; color: var(--rf-neutral-600); margin-top: 3px; }

.readflow-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 999px;
  border: 1px solid var(--rf-divider); background: transparent;
  color: var(--rf-neutral-700); cursor: pointer; flex: none;
}
.readflow-icon-btn:hover { background: color-mix(in srgb, var(--rf-text) 7%, transparent); }
.readflow-icon-btn:focus-visible { outline: 2px solid var(--rf-accent); outline-offset: 2px; }
.readflow-icon-btn-plain { border-color: transparent; }
.readflow-icon-btn-text { font: 600 12px/1 var(--rf-font-heading); }

.readflow-body { flex: 1; overflow-y: auto; padding: var(--rf-space-4); }

.readflow-footer {
  padding: var(--rf-space-3) var(--rf-space-4);
  border-top: 1px solid var(--rf-divider);
  display: flex; flex-direction: column; gap: var(--rf-space-2);
  flex: none;
}
.readflow-footer-row { display: flex; align-items: center; gap: var(--rf-space-2); }

/* — buttons — */
.readflow-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border-radius: 999px; border: none; cursor: pointer;
  font-family: var(--rf-font-heading); font-size: 14px;
  padding: 12px 15px;
}
.readflow-btn-block { width: 100%; }
.readflow-btn-primary { background: var(--rf-accent); color: var(--rf-bg); }
.readflow-btn-primary:hover { background: var(--rf-accent-600); }
.readflow-btn-primary:active { background: var(--rf-accent-700); }
.readflow-btn-secondary {
  border: 1px solid var(--rf-divider); background: transparent; color: var(--rf-text);
  font-size: 13.5px; padding: 9px 14px;
}
.readflow-btn-secondary:hover { background: color-mix(in srgb, var(--rf-text) 7%, transparent); }
.readflow-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.readflow-btn:focus-visible { outline: 2px solid var(--rf-accent); outline-offset: 2px; }
.readflow-spacer { flex: 1; }

/* — settings fields (shared: start state + overlay) — */
.readflow-settings { display: flex; flex-direction: column; gap: var(--rf-space-4); }
.readflow-settings-group { display: flex; flex-direction: column; gap: var(--rf-space-2); }
.readflow-settings-label {
  font: 600 11px/1.4 var(--rf-font-body); letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--rf-neutral-600);
}

.readflow-level-seg {
  display: inline-flex; gap: 4px; padding: 3px; border-radius: 999px;
  background: var(--rf-neutral-200); align-self: flex-start;
}
.readflow-level-opt {
  border: none; border-radius: 999px; padding: 5px 13px; cursor: pointer;
  font: 400 13px/1.2 var(--rf-font-heading); background: transparent; color: var(--rf-neutral-700);
}
.readflow-level-opt.active { background: var(--rf-accent); color: var(--rf-bg); }
.readflow-level-opt:focus-visible { outline: 2px solid var(--rf-accent); outline-offset: 2px; }

.readflow-stepper { display: flex; align-items: center; gap: var(--rf-space-2); }
.readflow-stepper-btn {
  width: 36px; height: 36px; border-radius: 999px; border: 1px solid var(--rf-divider);
  background: transparent; color: var(--rf-text); font: 400 17px/1 var(--rf-font-heading);
  cursor: pointer;
}
.readflow-stepper-btn:hover { background: color-mix(in srgb, var(--rf-text) 7%, transparent); }
.readflow-stepper-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.readflow-stepper-btn:focus-visible { outline: 2px solid var(--rf-accent); outline-offset: 2px; }
.readflow-stepper-value { min-width: 46px; text-align: center; font: 400 19px/1.2 var(--rf-font-heading); }
.readflow-stepper-unit { font-size: 13px; color: var(--rf-neutral-700); }

.readflow-checkbox-row { display: flex; align-items: center; gap: var(--rf-space-2); font-size: 13.5px; margin-top: var(--rf-space-2); }

.readflow-apikey-row { display: flex; align-items: center; gap: var(--rf-space-2); flex-wrap: wrap; }
.readflow-apikey-value { font-size: 14px; }
.readflow-apikey-tag { padding: 3px 9px; border-radius: 999px; font: 600 11px/1.4 var(--rf-font-body); }
.readflow-apikey-tag.verified { background: var(--rf-accent2-200); color: var(--rf-accent2-700); }
.readflow-apikey-tag.missing { background: var(--rf-accent-200); color: var(--rf-accent-700); }
.readflow-apikey-edit { display: none; flex: 1 0 100%; gap: var(--rf-space-2); margin-top: var(--rf-space-2); }
.readflow-apikey-edit.open { display: flex; }
.readflow-apikey-edit input {
  flex: 1; min-height: 36px; padding: 6px 12px; font: inherit; font-size: 13px;
  color: var(--rf-text); background: var(--rf-surface);
  border: 1px solid var(--rf-divider); border-radius: 999px;
}
.readflow-apikey-edit input:focus-visible { border-color: var(--rf-accent); outline: none; }
.readflow-link-btn {
  background: none; border: none; padding: 0; font: 400 13px/1.4 var(--rf-font-body);
  color: var(--rf-accent-700); cursor: pointer; text-decoration: underline;
}

/* — tabs — */
.readflow-tabs { display: flex; gap: 6px; }
.readflow-tab {
  flex: 1; border-radius: 999px; padding: 9px 6px; cursor: pointer;
  font: 400 14px/1.2 var(--rf-font-heading); display: inline-flex; align-items: center;
  justify-content: center; gap: 6px; background: var(--rf-neutral-200); color: var(--rf-neutral-700);
  border: 1px solid transparent;
}
.readflow-tab.active { background: var(--rf-accent); color: var(--rf-bg); border-color: var(--rf-accent); }
.readflow-tab:focus-visible { outline: 2px solid var(--rf-accent); outline-offset: 2px; }
.readflow-tab-badge {
  font: 600 11px/1 var(--rf-font-body); padding: 3px 6px; border-radius: 999px;
  background: color-mix(in srgb, var(--rf-text) 10%, transparent); color: var(--rf-neutral-700);
}
.readflow-tab.active .readflow-tab-badge {
  background: color-mix(in srgb, #f5ead8 32%, transparent); color: var(--rf-bg);
}

/* — outline tab — */
.readflow-outline { display: flex; flex-direction: column; gap: var(--rf-space-3); }
.readflow-outline-scene {
  padding: var(--rf-space-3) var(--rf-space-4); border-radius: var(--rf-radius-md);
  background: var(--rf-accent2-100); border: 1px solid var(--rf-accent2-200);
}
.readflow-outline-scene-label {
  font: 600 11px/1.4 var(--rf-font-body); letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--rf-accent2-700); margin-bottom: 6px;
}
.readflow-outline-scene p { margin: 0; font-size: 14.5px; line-height: 1.65; }
.readflow-outline-points { display: flex; flex-direction: column; gap: var(--rf-space-3); }
.readflow-outline-point { display: flex; gap: var(--rf-space-3); }
.readflow-outline-dot { flex: none; width: 9px; height: 9px; border-radius: 999px; background: var(--rf-accent); margin-top: 8px; }
.readflow-outline-point p { margin: 0; font-size: 14.5px; line-height: 1.65; }
.readflow-outline-footnote { margin: 0; font-size: 12px; color: var(--rf-neutral-600); }

/* — vocab tab — */
.readflow-vocab-list { display: flex; flex-direction: column; gap: var(--rf-space-3); }
.readflow-vocab-card {
  border-radius: var(--rf-radius-md); background: var(--rf-surface); box-shadow: var(--rf-shadow-sm);
  padding: var(--rf-space-3) var(--rf-space-4); display: flex; flex-direction: column; gap: var(--rf-space-2);
}
.readflow-vocab-head { display: flex; align-items: baseline; gap: var(--rf-space-2); }
.readflow-vocab-word { font: 400 19px/1.2 var(--rf-font-heading); color: var(--rf-accent-800); }
.readflow-vocab-pos { font: 400 12px/1.2 var(--rf-font-body); color: var(--rf-neutral-600); font-style: italic; }
.readflow-vocab-zh { margin: 0; font-size: 14.5px; line-height: 1.6; }
.readflow-vocab-quote {
  margin: 0; padding-left: var(--rf-space-3); border-left: 3px solid var(--rf-accent-300);
  font-size: 13.5px; line-height: 1.55; color: var(--rf-neutral-700); font-style: italic;
}
.readflow-speak-btn {
  width: 30px; height: 30px; border-radius: 999px; border: 1px solid var(--rf-divider);
  background: transparent; color: var(--rf-neutral-700); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; flex: none;
}
.readflow-speak-btn:hover { background: color-mix(in srgb, var(--rf-text) 8%, transparent); }
.readflow-speak-btn:focus-visible { outline: 2px solid var(--rf-accent); outline-offset: 2px; }
.readflow-mark-btn {
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; flex: none;
  border-radius: 999px; padding: 5px 11px; font: 400 12.5px/1.2 var(--rf-font-heading); cursor: pointer;
  background: transparent; color: var(--rf-accent2-700);
  border: 1px solid color-mix(in srgb, var(--rf-accent-2) 55%, transparent);
}
.readflow-mark-btn.active { background: var(--rf-accent2-600); color: var(--rf-bg); border-color: var(--rf-accent2-600); }
.readflow-mark-btn:focus-visible { outline: 2px solid var(--rf-accent); outline-offset: 2px; }

/* — grammar tab — */
.readflow-grammar-list { display: flex; flex-direction: column; gap: var(--rf-space-3); }
.readflow-grammar-card {
  border-radius: var(--rf-radius-md); background: var(--rf-surface); box-shadow: var(--rf-shadow-sm);
  padding: var(--rf-space-3) var(--rf-space-4); display: flex; flex-direction: column; gap: var(--rf-space-2);
}
.readflow-grammar-frag {
  display: block; background: var(--rf-neutral-200); color: var(--rf-accent-800);
  padding: 7px 11px; border-radius: var(--rf-radius-sm); font: 400 13px/1.5 ui-monospace, monospace;
}
.readflow-grammar-note { margin: 0; font-size: 14.5px; line-height: 1.6; }
.readflow-grammar-rewrite-row { display: flex; gap: var(--rf-space-2); align-items: baseline; }
.readflow-grammar-rewrite-label {
  flex: none; font: 600 11px/1.4 var(--rf-font-body); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--rf-accent2-700);
}
.readflow-grammar-rewrite-row p { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--rf-neutral-700); }

/* — settings overlay (gear icon, result state only) — */
.readflow-settings-overlay {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; box-sizing: border-box; z-index: 30;
  background: color-mix(in srgb, #201e1d 34%, transparent);
  display: flex; align-items: flex-start; justify-content: center; padding: var(--rf-space-4);
}
.readflow-settings-card {
  width: 100%; border-radius: var(--rf-radius-lg); background: var(--rf-bg); box-shadow: var(--rf-shadow-lg);
  padding: var(--rf-space-4); display: flex; flex-direction: column; gap: var(--rf-space-4);
  max-height: calc(100% - var(--rf-space-4) * 2); overflow-y: auto;
}
.readflow-settings-card-head { display: flex; align-items: center; gap: var(--rf-space-2); }
.readflow-settings-card-head h3 { font: 400 20px/1.1 var(--rf-font-heading); letter-spacing: -0.015em; margin: 0; flex: 1; }
.readflow-settings-actions { display: flex; gap: var(--rf-space-2); }
.readflow-settings-actions .readflow-btn-secondary { flex: 1; }
.readflow-settings-actions .readflow-btn-primary { flex: 1.4; }

/* — status blocks — */
.readflow-loading { color: var(--rf-accent-700); font-style: italic; font-size: 14px; }
.readflow-error {
  color: var(--rf-accent-800); background: var(--rf-accent-100); border: 1px solid var(--rf-accent-200);
  border-radius: var(--rf-radius-md); padding: var(--rf-space-3) var(--rf-space-4); font-size: 14px; line-height: 1.6;
}
.readflow-note {
  color: var(--rf-accent2-700); background: var(--rf-accent2-100); border-radius: var(--rf-radius-md);
  padding: var(--rf-space-2) var(--rf-space-3); font-size: 12px; margin-bottom: var(--rf-space-3);
}
.readflow-usage { color: var(--rf-neutral-600); font-size: 11px; margin-top: var(--rf-space-3); }

/* — highlight mark left in the book's own page content (unrelated to the panel's tokens) — */
mark.readflow-highlight { background: #ffe066; color: inherit; }
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "$(cat <<'EOF'
style: replace ReadFlow drawer styling with the Organic design system

Full token + component swap (direction 1a — warm cream ground,
terracotta/sage accents, Caprasimo/Figtree, pill shapes). Class names
match what the Task 3 content.js rewrite renders; nothing consumes
these classes yet, so this is a no-op until that task lands.
EOF
)"
```

---

## Task 3: `content.js` — new state, rendering, settings, TTS, and marking

**Files:**
- Modify: `content.js` (full-file rewrite)
- Create: `tests/content.test.js`

**Interfaces:**
- Consumes: every `.readflow-*` class and `--rf-*` token from Task 2's `styles.css`; `chrome.runtime.sendMessage({ type: 'analyzeChapter', pages, apiKey, level })` from Task 1, expecting a callback with `{ result: {scene, points, vocab, grammar}, usage }` or `{ error }`.
- Produces (exported for tests): `clampPageCount(count)`, `computeTabCounts(result)`, `maskApiKey(key)`, `escapeHtml(str)`.

- [ ] **Step 1: Write the failing tests for the new pure helpers**

Create `tests/content.test.js`:

```js
const { clampPageCount, computeTabCounts, maskApiKey, escapeHtml } = require('../content.js');

describe('clampPageCount', () => {
  test('clamps below the minimum up to 1', () => {
    expect(clampPageCount(-5)).toBe(1);
  });
  test('clamps above the maximum down to 100', () => {
    expect(clampPageCount(500)).toBe(100);
  });
  test('passes through values already in range', () => {
    expect(clampPageCount(25)).toBe(25);
  });
});

describe('computeTabCounts', () => {
  test('counts points, vocab, and grammar entries', () => {
    const result = {
      points: ['a', 'b', 'c'],
      vocab: [{ word: 'x' }, { word: 'y' }],
      grammar: [{ frag: 'z' }],
    };
    expect(computeTabCounts(result)).toEqual({ outline: 3, vocab: 2, grammar: 1 });
  });
});

describe('maskApiKey', () => {
  test('masks the middle of a normal-length key', () => {
    expect(maskApiKey('AIzaSyABCDEF4f2c')).toBe('AIza····4f2c');
  });
  test('returns an empty string for no key', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey(undefined)).toBe('');
  });
  test('returns very short keys unmasked', () => {
    expect(maskApiKey('short')).toBe('short');
  });
});

describe('escapeHtml', () => {
  test('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });
  test('passes through plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/content.test.js`
Expected: FAIL — `Cannot destructure property 'clampPageCount' ... require(...) is not a function or its return value is undefined` (content.js exports nothing yet).

- [ ] **Step 3: Rewrite `content.js` in full**

```js
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
let lastResult = null;               // { scene, points, vocab, grammar }
let lastMeta = null;                 // { pageCount, level, reachedEnd, usage, debug }
let resultTab = 'outline';           // 'outline' | 'vocab' | 'grammar'
let currentView = 'start';           // 'start' | 'loading' | 'result' | 'error'
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

  chrome.storage.local.get(['apiKey'], ({ apiKey }) => {
    currentApiKey = apiKey || '';
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
        <div class="readflow-settings-label">Gemini API Key</div>
        <div class="readflow-apikey-row">
          ${apiKeyDisplay}
          <span class="readflow-spacer"></span>
          <button class="readflow-link-btn" data-action="apikey-edit-toggle">更改</button>
          <div class="readflow-apikey-edit${apiKeyEditOpen ? ' open' : ''}">
            <input type="password" id="readflow-apikey-input" placeholder="AIza...">
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

  const cards = result.grammar.map((g) => `
    <div class="readflow-grammar-card">
      <code class="readflow-grammar-frag">${escapeHtml(g.frag)}</code>
      <p class="readflow-grammar-note">${escapeHtml(g.note)}</p>
      <div class="readflow-grammar-rewrite-row">
        <span class="readflow-grammar-rewrite-label">改寫</span>
        <p>${escapeHtml(g.rewrite)}</p>
      </div>
    </div>
  `).join('');
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
    const delta = action === 'inc-pages' ? 5 : -5;
    if (scope === 'start') { panelPageCount = clampPageCount(panelPageCount + delta); renderDrawerStart(); }
    else { settingsDraft.pageCount = clampPageCount(settingsDraft.pageCount + delta); renderDrawerResult(); }
    return;
  }
  if (action === 'pick-tab') { resultTab = el.dataset.tab; renderDrawerResult(); return; }
  if (action === 'speak') { speakWord(el.dataset.word); return; }
  if (action === 'toggle-mark') { toggleMark(el.dataset.word); return; }
  if (action === 'font-dec') { applyBodyFontSize(bodyFontSize - 1); return; }
  if (action === 'font-inc') { applyBodyFontSize(bodyFontSize + 1); return; }
  if (action === 'apikey-edit-toggle') { apiKeyEditOpen = !apiKeyEditOpen; rerenderCurrentView(); return; }
  if (action === 'apikey-save') {
    const input = drawerBody.querySelector('#readflow-apikey-input');
    const value = input ? input.value.trim() : '';
    if (!value) return;
    chrome.storage.local.set({ apiKey: value }, () => {
      currentApiKey = value;
      apiKeyEditOpen = false;
      rerenderCurrentView();
    });
    return;
  }
}

function onDrawerChange(e) {
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
  chrome.storage.local.get(['apiKey'], ({ apiKey }) => {
    if (!apiKey) {
      renderDrawerError('尚未設定 Gemini API Key，請在上方「設定」中新增。');
      setDrawerOpen(true);
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'analyzeChapter', pages, apiKey, level: panelLevel },
      (response) => {
        if (chrome.runtime.lastError || response?.error) {
          const msg = response?.error || chrome.runtime.lastError?.message;
          renderDrawerError(`Error: ${msg}`);
          setDrawerOpen(true);
          return;
        }
        lastResult = response.result;
        lastMeta = {
          pageCount: pages.length,
          level: panelLevel,
          reachedEnd,
          usage: response.usage,
          debug: false,
        };
        resultTab = 'outline';
        renderDrawerResult();
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

if (typeof module !== 'undefined') {
  module.exports = { clampPageCount, computeTabCounts, maskApiKey, escapeHtml };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/content.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npx jest`
Expected: `tests/renderMarkdown.test.js` FAILS — `renderMarkdown` no longer exists in `content.js` and `lib/renderMarkdown.js` is now unused. This is expected; Task 5 removes that file and its test. Every other suite (`background.test.js`, `popup.test.js`, `joinPageTexts.test.js`, `content.test.js`) should PASS.

- [ ] **Step 6: Commit**

```bash
git add content.js tests/content.test.js
git commit -m "$(cat <<'EOF'
feat: rebuild the Chapter Guide drawer on the Organic design system

New start/loading/result/error states, outline/vocab/grammar tabs,
a settings panel (level, page-count stepper, current-page-only,
inline API key edit) shared between the start state and a gear-icon
overlay, per-word TTS + marking, and A-/A+ font controls preserved
in the new header. Capture/cross-frame mechanics are unchanged.

tests/renderMarkdown.test.js now fails — cleaned up in the next commit.
EOF
)"
```

---

## Task 4: Update the manual-test harness for the structured result shape

**Files:**
- Modify: `manual-test/harness.html`

**Interfaces:**
- Consumes: Task 3's `content.js` (expects `chrome.runtime.sendMessage`'s callback to receive `{ result: {scene, points, vocab, grammar}, usage }`, and reads `msg.level` from the outgoing message).

- [ ] **Step 1: Replace the fake result template and mock `sendMessage`**

In `manual-test/harness.html`, replace the `FAKE_RESULT_TEMPLATE` declaration and the body of `chrome.runtime.sendMessage`:

Old (inside the `<script>` block that stubs `window.chrome`):
```js
  // ReadFlow analyzes English books for a Chinese-speaking reader (see
  // background.js's CHAPTER_SYSTEM_PROMPT): captured pages are English
  // text, and the analysis explains English vocab/grammar in Chinese —
  // this canned result follows that same shape.
  var FAKE_RESULT_TEMPLATE = '**📖 章節大綱 (Outline)**\n' +
    '主角在雨夜舊書店中，意外發現一本封面斑駁的筆記本，裡頭夾著一封從未寄出的信，字跡因潮濕而暈染，讀來帶著一絲惆悵；隨著她繼續翻閱，某段文字忽然變得工整，像是另一人接手寫下，暗示還有未解的伏筆等著揭曉。\n\n' +
    '**📚 困難生字 (Difficult Vocabulary)**\n' +
    '* **mottled**（adj. 形容詞）：表面帶有斑駁色塊、不均勻，原文用來形容筆記本封面因年代久遠產生的痕跡（"its cover worn and mottled with age"），可理解為「舊舊髒髒、顏色不均」。\n' +
    '* **wistful**（adj. 形容詞）：帶著淡淡感傷與懷念、若有所失的心情，原文 "left her with a lingering, wistful sadness" 描述她讀完信後的感受，語氣比 sad 更含蓄。\n' +
    '* **deliberate**（adj. 形容詞）：這裡指刻意、工整、經過用心書寫，不是「延遲」的意思；原文 "grew neat and deliberate" 形容字跡忽然變得端正、像是特意寫成的。\n\n' +
    '**📝 困難文法 (Difficult Grammar)**\n' +
    '* `as if someone else had taken over the writing`：`as if` 後面接過去完成式（had + p.p.），用來描述「其實未必是事實、只是看起來像」的假設情境，這種語氣在描述懷疑或推測時很常見。\n\n' +
    '**🧪 測試除錯：實際擷取到的原始內容**\n' +
    '{{DEBUG_PAGES}}';

  window.chrome = {
    storage: {
      local: {
        get: function (keys, cb) {
          cb(window.__harness.apiKeyPresent ? { apiKey: 'harness-fake-key' } : {});
        }
      }
    },
    runtime: {
      lastError: null,
      // Real signature also carries a sender arg (chrome.runtime.onMessage
      // passes msg, sender, sendResponse) — content.js only ever reads the
      // first and calls-back the third, so this stub keeps just those two.
      sendMessage: function (msg, cb) {
        setTimeout(function () {
          if (window.__harness.forceError) {
            cb({ error: '(模擬) 無法連線至 Gemini，請稍後再試' });
            return;
          }
          var debugLines = msg.pages.map(function (p, i) {
            return '* 第 ' + (i + 1) + ' 頁：`' + p.slice(0, 24) + (p.length > 24 ? '…' : '') + '`';
          }).join('\n');
          var result = FAKE_RESULT_TEMPLATE.replace('{{DEBUG_PAGES}}', debugLines || '（沒有擷取到任何內容）');
          cb({
            result: result,
            usage: {
              promptTokenCount: 800 + msg.pages.length * 42,
              candidatesTokenCount: 356,
              totalTokenCount: 1156 + msg.pages.length * 42
            }
          });
        }, 650);
      }
    }
  };
```

New:
```js
  // ReadFlow analyzes English books for a Chinese-speaking reader (see
  // background.js's CHAPTER_SYSTEM_PROMPT): captured pages are English
  // text, and the analysis explains English vocab/grammar in Chinese —
  // this canned result follows the structured {scene, points, vocab,
  // grammar} shape background.js now returns.
  var FAKE_VOCAB = [
    { word: 'mottled', pos: 'adj.', zh: '表面帶有斑駁色塊、不均勻，這裡形容筆記本封面因年代久遠產生的痕跡。', quote: '原文："its cover worn and mottled with age"' },
    { word: 'wistful', pos: 'adj.', zh: '帶著淡淡感傷與懷念、若有所失的心情，語氣比 sad 更含蓄。', quote: '原文："left her with a lingering, wistful sadness"' },
    { word: 'deliberate', pos: 'adj.', zh: '這裡指刻意、工整、經過用心書寫，不是「延遲」的意思。', quote: '原文："grew neat and deliberate"' },
  ];
  var FAKE_GRAMMAR = [
    { frag: 'as if someone else had taken over the writing', note: '`as if` 後面接過去完成式（had + p.p.），描述「看起來像、但未必是事實」的假設情境。', rewrite: 'it looked like someone else had written it' },
  ];

  window.chrome = {
    storage: {
      local: {
        get: function (keys, cb) {
          cb(window.__harness.apiKeyPresent ? { apiKey: 'harness-fake-key' } : {});
        }
      }
    },
    runtime: {
      lastError: null,
      // Real signature also carries a sender arg (chrome.runtime.onMessage
      // passes msg, sender, sendResponse) — content.js only ever reads the
      // first and calls-back the third, so this stub keeps just those two.
      sendMessage: function (msg, cb) {
        setTimeout(function () {
          if (window.__harness.forceError) {
            cb({ error: '(模擬) 無法連線至 Gemini，請稍後再試' });
            return;
          }
          cb({
            result: {
              scene: '主角在雨夜舊書店中，意外發現一本封面斑駁的筆記本，裡頭夾著一封從未寄出的信，字跡因潮濕而暈染，讀來帶著一絲惆悵。',
              points: [
                '隨著她繼續翻閱，某段文字忽然變得工整，像是另一人接手寫下，暗示還有未解的伏筆等著揭曉。',
                '（測試面板）本次共擷取 ' + msg.pages.length + ' 頁內容，程度：' + (msg.level || '未指定') + '。'
              ],
              vocab: FAKE_VOCAB,
              grammar: FAKE_GRAMMAR
            },
            usage: {
              promptTokenCount: 800 + msg.pages.length * 42,
              candidatesTokenCount: 356,
              totalTokenCount: 1156 + msg.pages.length * 42
            }
          });
        }, 650);
      }
    }
  };
```

- [ ] **Step 2: Manual verification pass**

Run: `npm run manual-test`, open `http://localhost:4173/manual-test/harness.html`.

Walk through, confirming each works:
1. Drawer tab reads "導讀" and opens the panel showing the start-state settings (level pills, page stepper, "只掃描目前頁面" checkbox, API key row showing "已驗證" with the harness's fake key).
2. Change level, adjust page count with +/−, toggle "只掃描目前頁面" (stepper disables).
3. Click "開始分析" → loading state with the "(n/total)" counter ticks → result state appears with header meta "N 頁 · 程度 X · 剛剛完成" (no page range) and three tabs.
4. Click through 大綱／生字／文法 — outline shows the scene card + bulleted points + footnote; vocab shows word/pos/朗讀/畫記 per card; grammar shows the code fragment + note + 改寫 row.
5. Click 朗讀 on a vocab card — no console error (actual audio output isn't verifiable headlessly, but the call must not throw).
6. Click 畫記 on a vocab word — button goes active, and the word gets wrapped in `<mark class="readflow-highlight">` inside the mock reader iframe (existing highlight mechanism).
7. Click the gear icon → settings overlay opens over the result. Change the level and click "儲存並重新分析" → drawer goes back to loading, then a new result. Reopen the gear, change page count only, click "取消" → confirm the page count reverts to what it was (draft discarded).
8. Click the circular-arrow "重新分析" button → re-runs immediately with current settings (no detour through the start state).
9. Click A－ / A＋ — body text in the result view visibly shrinks/grows and persists across a page reload (`localStorage['readflow-body-font-size']`).
10. Check "模擬 Gemini 連線失敗" in the harness panel, run an analysis → styled error card appears with a "返回設定" button that returns to the start state.
11. Click 收起 (X) in the result header → panel closes; the edge tab still reopens it with the last result intact.

- [ ] **Step 3: Commit**

```bash
git add manual-test/harness.html
git commit -m "$(cat <<'EOF'
test: update manual harness for the structured Chapter Guide result

sendMessage's mock now returns {scene, points, vocab, grammar} instead
of a markdown string, matching what background.js and the redesigned
content.js exchange.
EOF
)"
```

---

## Task 5: Remove the obsolete `renderMarkdown` helper

**Files:**
- Delete: `lib/renderMarkdown.js`
- Delete: `tests/renderMarkdown.test.js`

**Interfaces:** none — `renderMarkdown` has no remaining callers after Task 3 (the vocab-highlight regex that used to scan its HTML output, `addHighlightButtons`, was removed in Task 3 too, replaced by real `data-word` attributes on the vocab cards).

- [ ] **Step 1: Confirm nothing else references it**

Run: `grep -rn "renderMarkdown" --include=*.js --include=*.html . --exclude-dir=node_modules`
Expected: no matches outside `lib/renderMarkdown.js` and `tests/renderMarkdown.test.js` themselves.

- [ ] **Step 2: Delete the files**

```bash
git rm lib/renderMarkdown.js tests/renderMarkdown.test.js
```

- [ ] **Step 3: Run the full test suite**

Run: `npx jest`
Expected: PASS — all remaining suites (`background.test.js`, `content.test.js`, `popup.test.js`, `joinPageTexts.test.js`) green, no failures.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: remove renderMarkdown, unused after the structured-JSON redesign

The Chapter Guide result is now built from {scene, points, vocab,
grammar} directly (content.js renderTabBody), not markdown-to-HTML.
EOF
)"
```
