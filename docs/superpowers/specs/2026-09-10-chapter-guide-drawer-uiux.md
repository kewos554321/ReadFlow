# Chapter Guide — Drawer UI/UX Optimization Spec

## Status

Draft — pending user approval. **Supersedes**
[2026-09-08-chapter-guide-sidebar-uiux.md](2026-09-08-chapter-guide-sidebar-uiux.md)
in full. That spec was written against a DOM shape (separate persistent
icon + input popover + result panel) that no longer exists: commit
`a83ff00` ("consolidate icon+popup+sidebar into one edge-tab drawer")
merged all three into a single always-visible edge tab
(`.readflow-drawer-tab`) plus one sliding body (`.readflow-panel`), and
five follow-up commits (`d291b5d` … `af5019a`) have already shipped
small style refinements on top of that shape. This spec reviews the
UI/UX of *that* current shape — `content.js` and `styles.css` as they
exist today — against the same CRITICAL→LOW checklist the prior spec
used, since the underlying problems it identified (generic dev-tool
palette, fixed width, no keyboard access, no error recovery) were never
actually fixed; they just moved to new selectors.

## Why this exists

`styles.css` today is still the Task-6 placeholder: a hardcoded
`#1e1e2e` / `#cdd6f4` code-editor palette, a `#1a73e8` generic-SaaS
blue for every interactive accent, one fixed `360px` width, zero
`@media (prefers-color-scheme)` handling, zero focus states, zero
`aria-*`, and an error state that's just red text with no way forward.
None of that fits a **reading companion overlaid on a third-party page
we don't control**, which is what this feature actually is.

## Scope

The drawer as it exists now:
- `.readflow-drawer-tab` — the always-visible edge handle (open/close toggle)
- `.readflow-panel` — the sliding body, in its three states (input / loading / result)
- `.readflow-panel-restart` — the 🔄 button that returns from result to input
- `.readflow-highlight-btn` / `mark.readflow-highlight` — inline vocab-highlight controls
- `.readflow-note`, `.readflow-error`, `.readflow-loading`, `.readflow-usage` — inline status text

## Non-goals

- Detecting Play Books' own reading theme. Same reasoning as before:
  no reliable hook from the top frame, so the panel follows
  `prefers-color-scheme` instead.
- Rewriting `renderMarkdown()`'s inline syntax beyond the
  section-heading change below.
- Changing the capture/messaging logic (`runChapterCapture`,
  cross-frame `postMessage` protocol, timeout/re-entrancy guards). This
  is a visual/interaction spec on top of that, with one narrow
  functional exception: the retry button below.

## Design tokens

Same palette family as the superseded spec — warm paper / book tones,
not the current code-editor dark theme — because that reasoning didn't
change: it's what the built-in style database recommends for "Book &
Reading Tracker," and it's the one dimension where this should visibly
read as a reading product, not a dev tool.

```css
:root {
  --rf-bg: #FFFBEB;
  --rf-surface: #FFFFFF;
  --rf-text: #1C1917;
  --rf-text-muted: #57534E;
  --rf-border: #E7E2D8;
  --rf-primary: #92400E;     /* book-brown — replaces #1a73e8 everywhere */
  --rf-accent: #D97706;
  --rf-error: #B91C1C;
  --rf-error-bg: #FEF2F2;
  --rf-duration-enter: 220ms;
  --rf-duration-exit: 150ms;
}

@media (prefers-color-scheme: dark) {
  :root {
    --rf-bg: #1C1917;
    --rf-surface: #26221E;
    --rf-text: #F5F0E8;
    --rf-text-muted: #C9C2B8;
    --rf-border: #3A342C;
    --rf-primary: #FBBF24;
    --rf-accent: #F59E0B;
    --rf-error: #F87171;
    --rf-error-bg: #3A1F1F;
  }
}
```

Contrast (WCAG AA body ≥4.5:1, verified in the prior spec, unchanged
here since the values are unchanged): light `--rf-text` on `--rf-bg` ≈
16.8:1, `--rf-primary` on `--rf-bg` ≈ 6.9:1; dark `--rf-text` on
`--rf-bg` ≈ 14.9:1, `--rf-primary` on `--rf-bg` ≈ 10.1:1. Both clear
AAA for body text.

**Typography** (unchanged reasoning: skip Latin-only serif/display
pairings, they silently fall back on CJK content anyway):

```css
font-family: -apple-system, BlinkMacSystemFont, "PingFang TC",
  "Noto Sans TC", "Segoe UI", sans-serif;
```

`12px` labels/notes, `15px` body, `15px / 700` section headings, `1.7`
line-height.

## Component-by-component changes

### `.readflow-drawer-tab`

| Today | Change |
|---|---|
| `background: #1a73e8` | `var(--rf-primary)` |
| No `tabindex`/`role`/keyboard handler — only a `click` listener on a `<div>` | Add `tabindex="0" role="button" aria-label="ReadFlow 章節導讀，開啟或關閉" aria-expanded="{drawerOpen}"`; handle `Enter`/`Space` same as click. This is the single biggest gap carried over from the old spec — **the entire feature is currently unreachable without a mouse.** |
| `padding: 16px 8px`, vertical text — cross-axis (width) is likely well under 44px once padding + a 13px vertical run is accounted for | Set an explicit `min-width: 44px` (keep `writing-mode: vertical-rl` for the label, just guarantee the tap box) |
| Focus | Add `:focus-visible { outline: 2px solid var(--rf-primary); outline-offset: 2px; }` — there is currently no focus style on any element in this feature |
| `aria-expanded` | Toggle in `setDrawerOpen()` alongside the existing `classList.toggle('open', open)` |

### `.readflow-panel`

| Today | Change |
|---|---|
| `width: 360px` fixed | `width: min(380px, 92vw)` — Play Books frequently runs in a non-maximized or split window; a fixed 360px can exceed the viewport |
| No narrow-viewport handling | **Breakpoint at 480px:** switch to a bottom sheet — `position: fixed; left: 0; right: 0; bottom: 0; top: auto; max-height: 75vh; border-radius: 16px 16px 0 0; transform: translateY(100%);` / `.open { transform: translateY(0); }` — a right-docked full-height panel at that width would cover nearly the whole page, defeating the reason a panel (not a modal) was chosen |
| `background: #1e1e2e; color: #cdd6f4` | `background: var(--rf-bg); color: var(--rf-text)` |
| No border-radius | `border-radius: 16px 0 0 16px` (top-left/bottom-left only — it's docked to the right edge; a full 4-corner radius reads wrong on an edge-docked panel). Bottom-sheet variant: `16px 16px 0 0` |
| Default browser scrollbar | Custom: `scrollbar-color: var(--rf-text-muted) var(--rf-border);` + `::-webkit-scrollbar` thumb/track in the same tokens, so it doesn't look like unstyled chrome dropped onto a designed surface |
| `transition: transform 0.25s ease` (no distinct enter/exit, no reduced-motion) | `transition: transform var(--rf-duration-enter) ease-out, opacity var(--rf-duration-enter) ease-out;` on enter; a `.closing` state (or `transitionend`-driven class) at `var(--rf-duration-exit) ease-in` for exit — exit faster than enter reads as more responsive. Wrap the transform in `@media (prefers-reduced-motion: reduce) { transition-property: opacity; }` — never disable the panel, just the slide |
| No `role`/`aria-label` on the container | `role="complementary" aria-label="章節導讀"` |

### Loading state (`renderDrawerLoading`)

| Today | Change |
|---|---|
| Plain `<span class="readflow-loading">` text, no live region | Wrap in `aria-live="polite"` so page-turn progress announces without the user watching the screen |
| No visual progress feedback beyond the text changing | Add a lightweight three-dot opacity pulse next to the text (`opacity` only, no layout impact), paused under `prefers-reduced-motion` |
| `color: #89b4fa` | `var(--rf-primary)` |

### Result state / status text

| Today | Change |
|---|---|
| `.readflow-error { color: #f38ba8 }` — color only, no background, no semantic role | `color: var(--rf-error); background: var(--rf-error-bg);` on a padded block, `role="alert"` on the containing element — so it reads as a distinct status region, not a red word (`color-not-only`), and screen readers announce it without polling |
| No recovery path on Gemini/network error — just the red text (`onCaptureFinished`'s `response?.error` branch) | **Functional change, the one this spec asks for beyond CSS:** add a "重試" button next to the error text that re-invokes the same capture. Requires holding the last-used `pageCount` in a module-level variable (currently `onStartCapture` reads it from the input and discards it) so retry doesn't require reopening to the input state first |
| No API key case is styled the same red-text-only way, with copy telling the user what to do but no button to do it | Same error-block treatment, plus an actual `<button>`/`<a>` "前往設定" action — not just text saying to click the toolbar icon |
| `.readflow-note { color: #f9e2af }` (end-of-book banner) — color only | `color: var(--rf-accent)` text on a `var(--rf-accent)`-tinted background block, same "not color alone" reasoning as the error state |
| `.readflow-usage { color: #6c7086 }` | `var(--rf-text-muted)` |

### `.readflow-panel-restart` (🔄)

| Today | Change |
|---|---|
| `position: absolute; ... font-size: 15px`, icon glyph is the entire hit area | Icon can stay ~20px but the interactive box needs a `min-width: 44px; min-height: 44px;` (padding, not font-size, to get there) — currently the click target is roughly the glyph's rendered box, well under the 44×44 minimum |
| `title="重新分析"` only | Add `aria-label="重新分析"` — `title` alone isn't reliably exposed to screen readers |
| `color: #cdd6f4` | `var(--rf-text-muted)`, `var(--rf-primary)` on hover/focus |
| No focus style | Same `:focus-visible` ring as the drawer tab |

### `.readflow-highlight-btn`

| Today | Change |
|---|---|
| `padding: 1px 8px; font-size: 11px` — well under any touch-target minimum | This is an inline control sitting mid-sentence in dense vocab text, so a literal 44×44 box would break the reading flow; the pragmatic fix per HIG/MD's "extend hit area beyond visual bounds" guidance is `padding: 4px 10px` (visually modest, ~24-26px tall) plus an invisible `::before` hit-area extension bringing the effective tap box closer to 44px without changing layout. Flag this as the one control in the panel that can't cleanly hit the full CRITICAL minimum given its inline context — document the trade-off rather than silently ignoring it |
| `background: #313244`, `border: 1px solid #f9e2af`, `.active { background: #f9e2af }` | Map to tokens: `var(--rf-surface)` / `var(--rf-border)` default, `var(--rf-accent)` background when active |
| No focus style | Same `:focus-visible` ring |

### `mark.readflow-highlight`

`background: #ffe066` is decorative marking inside the *book's own
page content* (not this panel's chrome), so it intentionally stays
outside the token system — it needs to read as a highlighter mark
against whatever background Play Books itself is rendering, which this
panel has no visibility into. No change here.

## Content structure (heading treatment) — unchanged from prior spec

`renderMarkdown()` still turns `**📖 章節大綱**` into an inline
`<strong>`, indistinguishable from a bolded word mid-sentence. Extend
it (targeted, not a rewrite): a line that is *only* a bolded label
(`/^\*\*(.+)\*\*$/` matched on its own line, before the existing
`\n` → `<br>` pass) renders as `<h3 class="rf-section-heading">`
instead, styled `font-size: 15px; font-weight: 700; color:
var(--rf-primary); margin: 24px 0 8px;` (`0` top margin on the first
heading). Inline `**bold**` elsewhere is untouched. The 📖/📚/📝 emoji
stay — they're LLM-generated heading *content*, not structural UI
icons standing in for a control, so `no-emoji-icons` doesn't apply to
them the way it does to, say, the restart button.

## Escape / keyboard summary

- `Escape` while the panel is open closes it and returns focus to
  `.readflow-drawer-tab` (currently there is no keyboard path to close
  the panel at all once it's open, other than re-clicking the tab with
  a mouse).
- Tab order: drawer tab → (when open) panel content → restart/retry/
  settings button → highlight buttons, in visual order.

## Open questions for implementation

1. Retry's `pageCount` needs a module-level variable — trivial, but
   `onStartCapture` currently has no reason to retain it past the
   initial call; needs a small refactor, not just CSS.
2. The 480px bottom-sheet breakpoint is still a judgment call, not
   measured against real narrow-window Play Books usage — same caveat
   as the superseded spec, worth revisiting after manual testing.
3. The highlight-button touch-target trade-off (above) is a
   documented compromise, not a clean pass of the CRITICAL checklist —
   flagging it explicitly rather than either silently failing it or
   forcing a layout-breaking 44px box into running text.
