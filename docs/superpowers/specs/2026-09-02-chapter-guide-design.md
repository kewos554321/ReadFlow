# Chapter Guide — Design Spec

## Status
Approved by user on 2026-09-02. Ready for implementation planning.

## Problem

ReadFlow currently only explains text the user has already selected
(a word or a sentence), one page at a time. The user's actual goal is
different: **before starting to read a chapter**, they want to know
the chapter's outline, its difficult vocabulary, and its difficult
grammar, so they can read the chapter itself more smoothly.

Google Play Books' web reader shows one page (occasionally a two-page
spread) at a time and does not expose a simple way to read "the whole
current chapter" in one shot — there is no chapter-boundary API we
can rely on, and a single-page screenshot (the feature originally
discussed for a persistent icon) cannot capture chapter-level content.

This spec replaces that earlier "screenshot the current page" idea
with **Chapter Guide**: a feature that auto-advances through a
user-specified number of pages starting from wherever they currently
are, collects the real text of each page, and asks Gemini to produce
an outline + vocabulary + grammar briefing for that span before the
user reads it properly.

## Goals

- Let the user get an outline, a difficult-vocabulary list, and a
  difficult-grammar list for an upcoming stretch of pages, without
  leaving the reader.
- Keep the existing select-text-and-explain feature completely
  unchanged — Chapter Guide is a separate, additive code path.
- Return the reader to their original page after collecting content,
  so the feature doesn't disrupt their reading position.

## Non-goals

- Automatically detecting chapter boundaries (via Play Books' table of
  contents or heading heuristics). The user explicitly chose manual
  page-count entry instead — this is out of scope for this iteration.
- Persisting/caching chapter guides across sessions.
- Supporting book layouts other than the single-column reflow view
  already reverse-engineered during the earlier selection-icon bug fix
  (`reader-page` / `reader-rendered-page` / `ocean-sliced-element`
  structure, confirmed via live DOM inspection in this project).

## User flow

1. A persistent circular icon (reusing the existing `.readflow-icon`
   visual style) is shown fixed at the bottom-right of the browser
   viewport, injected once into the **top-level** `play.google.com`
   document only (not into any iframe, so it isn't duplicated per
   frame and isn't affected by iframe re-injection on
   `document.write()` re-renders, which was the source of an earlier
   bug in this project).
2. Clicking it opens a small inline panel next to the icon: a number
   input (default `10`) labeled "往後幾頁" and a "開始分析" button.
3. On submit, the icon switches to a loading/progress state (e.g. "正
   在翻頁擷取內容 (3/10)").
4. The extension auto-advances through that many pages inside the
   book-content iframe, extracting each page's text, then
   auto-navigates back to the original starting page.
5. The collected text is sent to Gemini with a new chapter-guide
   prompt. The response is rendered in a new, larger, scrollable
   result panel with three sections: 📖 章節大綱 (outline), 📚 困難生字
   (vocabulary), 📝 困難文法 (grammar).
6. Errors at any stage (no API key, page-turn failure, Gemini error)
   show as inline red error text in the same result panel, matching
   the existing error style used by the selection-tooltip feature.

This replaces the previously-discussed "explain the current page via
screenshot" persistent-icon feature outright; there is only one
persistent-icon mode.

## Components

### 1. `readflow-page-icon` (content.js, top frame only)

Created once, guarded by `window === window.top` and a
`document.getElementById('readflow-page-icon')` existence check (the
existence check also protects against duplicate creation if the
top-level document is ever re-injected, the same class of bug fixed
earlier for the selection-icon's `MutationObserver`).

States: idle (📖), open-panel (shows the page-count input), loading
(shows progress text), error (shows error text before returning to
idle).

### 2. Page-count input panel (content.js, top frame)

A small popover anchored above/beside the persistent icon. Plain
DOM + CSS, consistent visual language with `.readflow-tooltip`
(dark card, rounded corners). No new dependencies.

### 3. Auto page-turn + text collector (content.js, book-content iframe)

Runs inside the `books.googleusercontent.com/.../frame` document
(where the actual `reader-page` / `reader-rendered-page` DOM lives,
confirmed during the earlier selection-icon bug investigation).

Receives a `startChapterCapture` message (via `window.postMessage`
from the top frame, since the top frame's icon lives in a different
document than the iframe doing the page-turning — see "Cross-frame
messaging" below) carrying `{ pageCount }`.

Loop, `pageCount` times:
1. Dispatch a click on the current page's `.forward-gutter` element
   (fallback: dispatch an `ArrowRight` `keydown` on `document` if the
   click doesn't advance the page — **this needs to be validated
   experimentally during implementation**, see Risks).
2. Wait for the page to finish rendering. V1 uses a fixed delay
   (start with 500ms; tunable) rather than a robust "render complete"
   signal — see Risks.
3. Extract all visible paragraph text from the current
   `reader-rendered-page` (all `[ocean-sliced-element]` / `p`
   descendants, in DOM order, joined with newlines) and append to an
   in-memory array.

After the loop: click `.backward-gutter` (or `ArrowLeft`) the same
number of times to return to the starting page, then post the
collected text array back to the top frame.

If the loop can't advance further (e.g. end of book — detected by the
page content or `ocean-position` attribute not changing after a page
list turn attempt), stop early, still return whatever was collected,
and include a flag so the UI can note "已到達本書結尾，以下為已收集的
內容" instead of treating it as a hard error.

### 4. Cross-frame messaging

The persistent icon and its panel live in the top frame; the actual
page content and page-turn controls live in the nested
`books.googleusercontent.com` iframe. These are two different
`content.js` execution contexts (same file, injected per-frame per
the existing manifest `all_frames: true`), so they coordinate via
`window.postMessage`:

- Top frame → iframe: `{ source: 'readflow', type: 'startChapterCapture', pageCount }`
- Iframe → top frame: `{ source: 'readflow', type: 'chapterCaptureProgress', current, total }`
  (used to update the loading text)
- Iframe → top frame: `{ source: 'readflow', type: 'chapterCaptureResult', pages: string[], reachedEnd: boolean }`

The top frame locates the target iframe via
`document.querySelector('iframe').contentWindow` (there is exactly one
relevant iframe, per the existing DOM structure) and posts to it;
the iframe posts back to `window.top`. Both sides check
`event.data?.source === 'readflow'` before handling, since other
scripts on the page may also postMessage.

### 5. `callGeminiForChapter` (background.js)

New function alongside the existing `callGeminiApi`. Takes the
aggregated page texts (joined into one string, with a reasonable
truncation cap — see Risks) and a new system prompt (see below).
Reuses the existing `fetch`-based call pattern and the existing
`chrome.runtime.onMessage` listener, dispatching on a new
`message.type === 'analyzeChapter'`.

New prompt (Traditional Chinese, same tone/format conventions as the
existing `SYSTEM_PROMPT`):

```
# Role
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
* `[原文片段]`：說明句構或時態為何值得注意。
```

`generationConfig.maxOutputTokens` increases from the existing `600`
to `1500` to accommodate a multi-page-derived response.

### 6. Result panel (content.js + styles.css, top frame)

A new `.readflow-panel` element: a fixed-position panel sliding in
from the right edge of the viewport, full height, ~360px wide,
scrollable, with a close (×) button, rendering the three sections via
the existing `renderMarkdown()` — reused as-is, no changes needed
there. Chosen over a centered modal so the reader can still see (and
optionally keep interacting with) the page behind it. Replaces the
small `.readflow-tooltip` for this feature only; the selection-tooltip
flow is untouched.

## Data flow summary

```
[persistent icon click] -> [panel: page count input] -> [top frame]
  --postMessage--> [iframe: page-turn + extract loop]
  <--postMessage-- [iframe: progress updates, then final pages[]]
[top frame] --chrome.runtime.sendMessage(analyzeChapter)--> [background.js]
  --fetch--> [Gemini API]
[background.js] --sendResponse--> [top frame] -> [render result panel]
```

## Error handling

- No API key: same message as today ("No API key. Click the ReadFlow
  icon in the toolbar to add one."), shown in the result panel instead
  of a tooltip.
- Page-turn produces no progress at all after the first attempt
  (e.g. the click/key simulation doesn't work): abort with "無法自動
  翻頁，請改用選字功能" rather than looping indefinitely.
- Gemini API error: same red-text error rendering as the existing
  flow, using `response?.error` / `chrome.runtime.lastError`.
- Reaching the end of the book mid-capture: not an error — proceed
  with partial content and note it in the panel (see Component 3).

## Testing

- Unit-testable pieces (matching the existing `tests/` setup using
  Jest): the new `callGeminiForChapter` request-body builder (mirrors
  the existing `buildRequestBody` test in `tests/background.test.js`),
  and any pure text-aggregation helper (e.g. a
  `joinPageTexts(pages: string[]): string` function) if one is
  factored out.
- Page-turn simulation, cross-frame messaging, and the result panel
  are DOM/iframe-dependent and were not unit-testable for the
  existing selection-icon feature either — validate those manually
  in the live Play Books reader, the same way the selection-icon bug
  was diagnosed in this project (via direct browser inspection).

## Open risks (to validate during implementation, not blocking spec approval)

1. **Page-turn simulation mechanism is unverified.** We know
   `.forward-gutter` / `.backward-gutter` elements exist in the DOM,
   but we have not confirmed that a synthetic `click()` on them
   actually advances the page (Play Books' page-turn is driven by a
   complex Angular/RxJS event pipeline observed during earlier
   debugging). A keyboard-event fallback (`ArrowRight`/`ArrowLeft`)
   should be tried if direct clicks don't work.
2. **No reliable "page finished rendering" signal.** V1 uses a fixed
   delay. If this proves flaky (too slow = bad UX, too fast = text
   captured before render completes), a `MutationObserver` on the
   `reader-rendered-page` element (watching for its content changing)
   is the likely upgrade, but adds complexity and needs its own
   testing given the project's past experience with over-eager
   `MutationObserver` usage causing self-inflicted bugs.
3. **Token/length limits.** A 10+ page chapter's text could be long.
   A truncation or chunking strategy may be needed if requests start
   failing or getting truncated by Gemini — not designed in detail
   here, to be handled pragmatically during implementation based on
   real chapter lengths observed.
