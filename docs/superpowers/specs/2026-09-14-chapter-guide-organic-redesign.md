# Chapter Guide — Organic Redesign (Design 1a: 暖色卡片側欄)

## Status

Draft — pending user approval. **Supersedes**
[2026-09-10-chapter-guide-drawer-uiux.md](2026-09-10-chapter-guide-drawer-uiux.md)
in full. That spec proposed an ad-hoc "warm paper" palette on top of the
*existing* single-markdown-blob result and was never implemented
(`content.js`/`styles.css` still carry the original `#1e1e2e` code-editor
palette). This spec replaces that direction: visuals now come from a
Claude Design export (`~/Downloads/插件UIUX重新設計/ReadFlow 重新設計.dc.html`,
direction **1a**, "暖色卡片側欄") built on the "Organic" design system, and
the result itself changes shape — one markdown blob becomes three tabs
(大綱／生字／文法) backed by structured Gemini output.

## Source material

- `ReadFlow 重新設計.dc.html` (direction 1a only — 1b "E-Ink 優先" was
  presented alongside it as an alternative and is not being built)
- Design tokens: `_ds/organic-f0967be8-b55f-42e5-a91f-1dc75cff115b/styles.css`
  and its `readme.md`
- `github.md` in the same export folder (sync summary — confirms this
  export maps `content.js` / `styles.css` / `background.js` to the "1a / 1b"
  screens)

**Important translation note:** the `.dc.html` file, `support.js`, and
`_ds_bundle.js` are Claude Design's *canvas preview* runtime (`<x-dc>`,
`sc-if`, `sc-for`, `onClick="{{ }}"`, a `DCLogic`/React component class).
None of that ships. It's a reference for layout, copy, colors, and
interaction — the actual implementation is hand-written vanilla JS/CSS in
`content.js`/`styles.css`/`background.js`, following the project's existing
single-file/no-build-step/no-import convention (see the "Inlined:
renderMarkdown" comment already in `content.js`).

## Scope

- Full visual reskin of `.readflow-drawer-tab` / `.readflow-panel` to the
  Organic design system (warm cream ground, terracotta accent, sage
  second accent, Caprasimo headings over Figtree body, pill buttons,
  16px+ radii).
- Result content restructured into three tabs: 大綱 (outline) / 生字
  (vocab) / 文法 (grammar), each with its own card styling per the
  mockup.
- A settings panel (gear icon → overlay) covering: 英文程度 level
  (B1/B2/C1), 每次擷取頁數 (page-count stepper), 只掃描目前頁面 (kept
  from the current feature, not dropped), and Gemini API key
  (view + edit, mirroring `popup.js`'s storage).
- Before any analysis has run, the same settings-panel content renders
  inline (not an overlay) as the drawer's start state, with the primary
  button reading "開始分析" instead of "儲存並重新分析".
- Per-vocab-card 朗讀 (TTS, via `speechSynthesis`) and 畫記 (mark)
  controls.
- Footer action buttons "一次匯出全書筆記" / "只匯出本段" / "歷史" render
  per the mockup but **disabled**, `title="即將推出"` — no export/history
  storage work in this pass.
- `background.js`'s Gemini call switches from free-text markdown to
  structured JSON output, parameterized by `level`.

## Non-goals

- Direction 1b (E-Ink) — not built, not toggleable. If wanted later,
  it's a separate spec.
- 匯出筆記 / 歷史 functionality (storage schema, export format,
  multi-capture aggregation) — buttons are present but inert.
- Real page-number ranges ("p.142–151") — Play Books' embedded reader
  exposes no page numbers to the extension; the header shows page
  **count** only ("10 頁"), never a range.
- Changing the capture/messaging mechanics: `runChapterCapture`,
  cross-frame `postMessage` protocol, forward/backward gutter clicking,
  the capture timeout/re-entrancy guard. This spec changes what's
  rendered and what's requested from Gemini, not how pages are captured.
- Detecting Play Books' own reading theme / `prefers-color-scheme`
  support. The Organic system is a single warm-light palette by design
  (see its `readme.md`: "warmth is the point," "do not desaturate into
  greys") — no dark-mode variant is part of this redesign.

## Design tokens

Pulled directly from the Organic `styles.css` — extend ReadFlow's own
`styles.css` `:root` with these (not hardcoded hex per-rule):

```css
:root {
  --rf-bg: #f5ead8;
  --rf-surface: #ebddc5;
  --rf-text: #201e1d;
  --rf-accent: #c67139;
  --rf-accent-2: #7a8a5e;
  --rf-divider: color-mix(in srgb, #201e1d 16%, transparent);
  /* full 100-900 tonal ramps for neutral / accent / accent-2, copied
     verbatim from the Organic styles.css — see that file for exact hex */
  --rf-font-heading: "Caprasimo", system-ui, sans-serif;
  --rf-font-body: "Figtree", system-ui, sans-serif;
  --rf-space-1: 4.4px; --rf-space-2: 8.8px; --rf-space-3: 13.2px;
  --rf-space-4: 17.6px; --rf-space-6: 26.4px; --rf-space-8: 35.2px;
  --rf-radius-sm: 8px; --rf-radius-md: 16px; --rf-radius-lg: 28px;
  --rf-shadow-sm: 0 1px 2px color-mix(in srgb, #2e2b25 14%, transparent);
  --rf-shadow-md: 0 3px 10px color-mix(in srgb, #2e2b25 16%, transparent);
  --rf-shadow-lg: 0 12px 32px color-mix(in srgb, #2e2b25 22%, transparent);
}
```

Tokens are prefixed `--rf-*` (not `--color-*`/`--space-*` etc. as in the
raw export) to avoid collisions if any other extension styling ever
shares a page with unrelated `--color-*` custom properties on
play.google.com — the panel's CSS should never leak generic-looking
variable names onto a page it doesn't own.

**Fonts:** `@import url('https://fonts.googleapis.com/css2?family=Caprasimo...&family=Figtree...')`
at the top of `styles.css`, same as the design system does. Verified
live: `play.google.com/books` sends a CSP header with `script-src` only
(`content-security-policy: script-src 'nonce-...' 'unsafe-inline'
'strict-dynamic' https: http: 'unsafe-eval'; object-src 'none';
base-uri 'self'; ...`) — no `style-src`/`font-src`/`default-src`, so the
external font `@import` and its `fonts.gstatic.com` requests are not
blocked. No self-hosting needed.

**Icons:** inline SVGs copied directly from the mockup (Lucide, stroke-width
2.75) — no icon library dependency, consistent with zero-build-step.

## Component-by-component changes

### `.readflow-drawer-tab`

Restyle to `var(--rf-accent)` background / `var(--rf-bg)` text, pill-left
radius (`999px 0 0 999px` per the system's "over-round" direction),
label text becomes "導讀" (matches mockup) instead of "📖 導讀"; `(Debug)`
suffix in debug mode is preserved. Existing resize-handle and
open/close mechanics (`setDrawerOpen`, `applyPanelWidth`,
`onResizeHandlePointerDown`) are unchanged — this is a restyle, not a
behavior change.

### `.readflow-panel` — three states

**Start state** (no result yet — replaces `renderDrawerInput`): header
("本段導讀" title + icon), then the settings content inline: 英文程度
segmented control (B1/B2/C1 pills), 每次擷取頁數 stepper (−/+, step 5,
clamped 1–100, same clamps as today's `min`/`max`), 只掃描目前頁面
checkbox (disables the stepper exactly as it does today), Gemini API
key row (masked value + 已驗證/未設定 tag + inline edit), and a primary
pill button "開始分析" wired to the existing `onStartCapture` (using the
level/page-count/current-page-only values now living in this panel
instead of the old plain `<input>`s).

**Loading state**: restyled `renderDrawerLoading` — same
`(current/total)` text and timeout-driven error fallback
(`CAPTURE_TIMEOUT_MS`), new typography/color only.

**Result state**: header row (icon, "本段導讀", "N 頁 · 程度 X ·
剛剛完成", gear "設定" button, circular-arrow "重新分析" button, X
"收起" button) + tab bar (大綱／生字／文法, each with a count badge) +
tab body + footer (匯出全書筆記／只匯出本段 disabled, 生字本 N /
歷史 disabled, primary export button disabled). "重新分析" re-invokes
`onStartCapture` directly with the panel's current settings (no
round-trip through the start state) — a small behavior change from
today's 🔄, which resets to the blank input form; call this out to the
user before implementing since it changes an existing interaction, not
just its skin.

### Settings overlay (gear icon, from result state only)

Same content as the start-state settings block, rendered as an overlay
per the mockup (`position:absolute` panel-covering scrim + centered
card) with 取消 / 儲存並重新分析 actions. "儲存並重新分析" only
re-triggers capture if `level` changed (mirrors the mockup's copy:
"目前面板上的內容仍是舊程度的結果" implies changing page-count/API-key
alone doesn't force a reanalysis, only level does — page-count changes
apply on the *next* capture). 取消 discards any edits made in the
overlay and reverts to the last-saved values.

### Tabs — 大綱 (outline)

Renders `{ scene, points[] }` from the structured Gemini response: a
tinted "場景" card (accent-2 tones per the mockup) with the scene
summary, then a bullet list of `points` (each row: accent dot + text),
then a small note ("不含結局或關鍵轉折") — the note is static UI copy,
not LLM output (avoids relying on the model to remember to say it).

### Tabs — 生字 (vocab)

One card per `vocab[]` entry (`word`, `pos`, `zh`, `quote`): word +
part-of-speech, 朗讀 button (`speechSynthesis.speak(new
SpeechSynthesisUtterance(word))`, `lang: 'en-US'`), 畫記 pill button.
畫記 reuses the *existing* highlight mechanism
(`broadcastToDescendantFrames(..., { type: 'toggleHighlightRequest',
word })`) rather than inventing a new "starred word" concept — the top
frame keeps a `markedWords: Set<string>` in drawer state purely to
drive the button's on/off visual style, mirroring what it already
asked reader frames to toggle (no round-trip needed to know the
current state, since the top frame is the one initiating every
toggle).

### Tabs — 文法 (grammar)

One card per `grammar[]` entry (`frag`, `note`, `rewrite`): a `<code>`
fragment, explanation, and a labeled "改寫" rewrite line — matches the
mockup exactly, no new interaction.

### Vocab/grammar counts & tab badges

`counts = { outline: points.length, vocab: vocab.length, grammar:
grammar.length }`, computed from the structured response (mockup hints
at 4/3/2 as placeholder data, not fixed numbers).

## `background.js` changes

- `CHAPTER_SYSTEM_PROMPT` rewritten to request the four-field JSON shape
  (`scene`, `points`, `vocab`, `grammar`) instead of the current
  markdown headings, with `level` interpolated into the prompt (today
  it hardcodes "B1-B2程度讀者").
- `buildChapterRequestBody` adds `generationConfig.responseMimeType:
  "application/json"` and a `responseSchema` describing that shape
  (Gemini's structured-output feature), replacing the current
  free-text `maxOutputTokens`-only config.
- `callGeminiForChapter` parses `JSON.parse(data.candidates[0]...text)`
  instead of returning raw text; a parse failure surfaces as the
  existing error-message path (`response?.error`), not a silent
  fallback to markdown.
- `analyzeChapter` message gains a `level` field
  (`'B1'|'B2'|'C1'`), threaded from `content.js`'s settings state.
- Debug mode's canned result (`DEBUG_PAGES` handling in `content.js`)
  gets a structured fake payload (`scene`/`points`/`VOCAB`/`GRAMMAR`
  shape already close to this — `VOCAB`/`GRAMMAR` arrays are reused
  near-verbatim, `scene`/`points` replace the current fake markdown
  outline paragraph) so Debug mode still exercises the real render
  path with zero network calls.

## `popup.js` / API key

No change to `popup.js` itself. The settings panel in `content.js` adds
its own small save function that writes to the same
`chrome.storage.local.apiKey` key popup.js already uses — not a shared
module (this codebase inlines rather than imports across
content/popup/background, which run in different contexts and can't
share ES module state without a bundler this project doesn't have).

## Testing

- `tests/renderMarkdown.test.js` — removed. `renderMarkdown()` is no
  longer in the result-rendering path once output is structured JSON
  (it may still exist for other uses; if not, delete the function too).
- `tests/background.test.js` — updated for: `responseSchema` present in
  the request body, `level` interpolated into the prompt, JSON
  parsing of the mock response, parse-failure error path.
- `tests/popup.test.js` — unchanged (popup.js itself doesn't change).
- New: a small test for the in-panel API-key save path in `content.js`
  (if `content.js` gains any exportable pure functions as part of this
  work — most of it is DOM wiring, which this project's existing tests
  don't unit-test directly; match whatever precedent
  `tests/joinPageTexts.test.js` vs. the untested DOM code in
  `content.js` already sets).
- Manual verification via `manual-test/harness.html` (already exists
  for exactly this purpose per the "add manual test harness for the
  Chapter Guide drawer" commit) — walk all three panel states, both
  tabs' worth of settings entry points (start-state inline vs.
  gear-icon overlay), TTS, 畫記, and Debug mode.

## Open questions for implementation

1. Gemini's `responseSchema` structured-output feature needs the exact
   syntax verified against the `gemini-3.6-flash` model this project
   pins (`background.js`'s `GEMINI_MODEL`) — confirm it's supported for
   that model before relying on it; fall back to "ask for JSON in the
   prompt + `JSON.parse` the text response" if `responseSchema` isn't
   available for this model.
2. "重新分析" changing from "reset to blank form" to "re-run
   immediately with current settings" is a small behavior change
   outside pure restyling — flagging per the brainstorming spec's own
   non-goals framing (this spec's non-goals say capture mechanics
   don't change; this is the one narrow exception, same pattern as the
   superseded spec's retry-button exception).
3. Whether "儲存並重新分析" should also re-run when only `pageCount`
   changed (not just `level`) is inferred from the mockup's copy, not
   explicitly stated — worth confirming during implementation review
   rather than guessing further.
