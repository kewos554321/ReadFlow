# Chapter Guide — Sidebar UI/UX Design Spec

## Status
Draft — pending user approval. Supersedes the placeholder styling for
Component 6 in
[2026-09-02-chapter-guide-design.md](2026-09-02-chapter-guide-design.md)
and the CSS shipped in Task 6 of
[2026-09-07-chapter-guide.md](../plans/2026-09-07-chapter-guide.md).
Nothing else in either document changes — same DOM structure
(`.readflow-panel`), same states, same data flow.

## Why this exists

The implementation plan's Task 6 CSS was written to unblock wiring
(Gemini → panel), not as a considered design: fixed 360px width, one
hardcoded dark palette (`#1e1e2e` / `#cdd6f4`, a generic
code-editor dark theme), a flat `<strong>` treatment for section
headings, and no keyboard/focus handling. This spec replaces that
placeholder with a design considered for what the panel actually is:
a **reading companion**, injected over a **third-party page we don't
control**, that must stay legible on the E-Ink-adjacent, low-color
reading contexts the feature's own prompt already targets ("適合在
E-Ink 螢幕上快速瀏覽").

## Scope

Only the result panel (`.readflow-panel`, spec Component 6). The
persistent icon and input popover (spec Components 1–2) keep their
existing interaction model; this spec only extends their visual
tokens for consistency and fixes two accessibility gaps (keyboard
trigger, touch target size) called out in "Icon & popover" below.

## Non-goals

- Detecting or syncing to Play Books' own reading theme
  (light/sepia/dark). There is no reliable hook into it from the top
  frame; the panel instead follows the browser's
  `prefers-color-scheme`, which is the best available signal and is
  independent of whatever theme the book iframe is rendering in.
- Redesigning `renderMarkdown()`'s inline syntax (bold/code/em/list).
  Only its section-heading handling is extended (see "Content
  structure").

## Design tokens

Two token sets, switched via `@media (prefers-color-scheme: dark)`
(no manual toggle — matches system setting like the rest of the
browser chrome this panel lives next to).

Palette family: warm paper / book tones rather than a neutral
code-editor dark theme — this is the one dimension where a reading
product should visibly differ from a dev-tool aesthetic, and it's
what the built-in style database recommends for this exact product
type ("Book & Reading Tracker").

```css
:root {
  --rf-bg: #FFFBEB;          /* warm paper background */
  --rf-surface: #FFFFFF;     /* input panel / cards */
  --rf-text: #1C1917;        /* warm near-black, not pure #000 */
  --rf-text-muted: #57534E;
  --rf-border: #E7E2D8;
  --rf-primary: #92400E;     /* book-brown — headings, links, focus ring */
  --rf-accent: #D97706;      /* progress / active state */
  --rf-error: #B91C1C;
  --rf-error-bg: #FEF2F2;
}

@media (prefers-color-scheme: dark) {
  :root {
    --rf-bg: #1C1917;         /* warm near-black, not OLED #000 */
    --rf-surface: #26221E;
    --rf-text: #F5F0E8;       /* warm off-white, not pure #FFF */
    --rf-text-muted: #C9C2B8;
    --rf-border: #3A342C;
    --rf-primary: #FBBF24;    /* amber — enough contrast on dark surface */
    --rf-accent: #F59E0B;
    --rf-error: #F87171;
    --rf-error-bg: #3A1F1F;
  }
}
```

Contrast check (WCAG AA, body text ≥4.5:1):
- Light: `--rf-text` on `--rf-bg` ≈ 16.8:1; `--rf-primary` on `--rf-bg` ≈ 6.9:1.
- Dark: `--rf-text` on `--rf-bg` ≈ 14.9:1; `--rf-primary` on `--rf-bg` ≈ 10.1:1.

Both pass AA with margin, meeting AAA (7:1) for body text — worth it
given some users read on E-Ink-like low-contrast panels.

**Typography.** Content is Traditional Chinese; skip the generic
serif/display pairings a Latin-only font database suggests (Garamond,
Playfair) — they don't carry full CJK glyph sets and would silently
fall back anyway. Use the system CJK-aware stack already implied by
the plan, made explicit:

```css
font-family: -apple-system, BlinkMacSystemFont, "PingFang TC",
  "Noto Sans TC", "Segoe UI", sans-serif;
```

Scale: `12px` labels/notes, `15px` body (dense secondary-surface
text; the panel is a utility overlay, not the primary reading
surface, so slightly under the 16px body minimum is acceptable here),
`15px / 700` section headings, `1.7` line-height (unchanged from the
plan — already correct for CJK readability).

## Layout

```
┌───────────────────────────────────┐
│ ×                                 │  ← close, 44×44 hit area
│                                   │
│  📖 章節大綱                       │  ← section heading (icon + label,
│  2–4 句話...                       │     not a structural icon — see below)
│                                   │
│  📚 困難生字                       │
│  • 單字：解釋                       │
│  • 單字：解釋                       │
│                                   │
│  📝 困難文法                       │
│  • 原文片段：說明                   │
│                                   │
└───────────────────────────────────┘
```

- Width: `min(380px, 92vw)` — the plan's fixed `360px` breaks on
  narrow browser windows (Play Books is often used in a split-screen
  or non-maximized window); `92vw` caps it so it's never edge-to-edge.
- **Breakpoint at 480px viewport width:** below that, the right-docked
  full-height panel would cover nearly the entire window, which fails
  the "don't block the page behind it" reason the spec chose a panel
  over a modal in the first place. Switch to a bottom sheet instead:
  `position: fixed; left: 0; right: 0; bottom: 0; max-height: 75vh;
  border-radius: 16px 16px 0 0;`, sliding up instead of in from the
  right.
- Full height (or `max-height: 75vh` in the sheet variant), internal
  `overflow-y: auto`, `padding: 20px 16px`.
- Section rhythm: `24px` gap between the three sections, `8px`
  between list items within a section — one consistent spacing scale,
  not ad hoc.
- Corner radius: `16px` on the two visible corners only (`top-left` /
  `bottom-left` in the side-panel variant), `0` on the two glued to
  the viewport edge — a full 4-corner radius looks wrong on an
  edge-docked panel.
- Custom scrollbar (`scrollbar-color` / `::-webkit-scrollbar`) using
  `--rf-border` / `--rf-text-muted` so it doesn't look like unstyled
  browser chrome dropped onto a designed panel.

## States

| State | Trigger | Content |
|---|---|---|
| Loading | `onStartCapture()` fires | `aria-live="polite"` progress text: "正在翻頁擷取內容 (n/total)", plus a lightweight indeterminate-feeling indicator (see Motion) |
| Result | `chapterCaptureResult` → Gemini success | Three rendered sections |
| Partial + end-of-book | `reachedEnd: true` | Amber note banner above the sections (existing `.readflow-note`, restyled to token colors) — not treated as an error |
| No API key | checked before the Gemini call | Error styling + a single action: "前往設定" — clicking it should be a real affordance (not just red text), since the current copy already tells the user what to do but gives them no button to do it with |
| Gemini/network error | `response?.error` | Error styling **+ a "重試" (retry) button** that re-invokes `onStartCapture()` with the same page count. The existing plan only shows red text with no recovery path, which fails the "every error needs a way forward" guideline — this is the one functional (not just visual) change this spec asks for beyond CSS. Requires the last-used `pageCount` to be held in a variable so retry doesn't need the popover reopened. |

Error and note banners use `--rf-error` / `--rf-error-bg` and
`--rf-accent` on a tinted background respectively — not just colored
text — so they read as distinct at a glance, not just a different
font color (`color-not-only`).

## Motion

- Panel enter: `transform: translateX(100%) → 0` + `opacity: 0 → 1`,
  `220ms ease-out` (bottom-sheet variant: `translateY(100%) → 0`,
  same timing).
- Panel exit: `150ms ease-in` — faster than enter, per standard
  motion guidance, so dismissal feels responsive.
- `prefers-reduced-motion: reduce`: drop the transform, keep only a
  fast opacity crossfade (or none) — never disable the panel, just
  the slide.
- Loading indicator: three-dot opacity pulse (`opacity` only, no
  layout-affecting properties), paused/static under reduced motion.
- Input popover: `scale(0.95) + opacity 0 → scale(1) + opacity 1`,
  transform-origin at the icon corner it anchors to, `150ms`.
- All durations pulled from one set of CSS custom properties
  (`--rf-duration-enter: 220ms`, `--rf-duration-exit: 150ms`) so
  every future animation in this feature shares the same rhythm
  instead of hand-picked numbers per element.

## Accessibility & keyboard

- Panel container: `role="complementary"`,
  `aria-label="章節導讀結果"`. Non-modal by design (per the original
  spec's reasoning — user can still see/use the page behind it), so
  no focus trap; but on open, move focus to the panel's close button
  so keyboard/screen-reader users land somewhere sensible rather than
  focus staying on a now-obscured element.
- `Escape` closes the panel and returns focus to the 📖 icon.
- Close button: 44×44 hit area (icon glyph itself can stay ~20px,
  padded), `aria-label="關閉"`.
- Loading text region: `aria-live="polite"` so progress announces
  without the user needing to look at the screen.
- Error region: `role="alert"`.
- Focus ring: `2px solid var(--rf-primary)` with `2px` offset on every
  interactive element in the panel (close, retry, settings link) —
  the plan currently defines no focus styles at all.

## Icon & popover — two carried-over fixes

Reusing the plan's existing interaction model, but fixing two gaps
against this skill's CRITICAL checklist while the tokens are being
unified:

1. **Touch target:** plan's icon is `40×40px`; bump to `44×44px`
   (CRITICAL minimum, both platforms' guidance agree here).
2. **Keyboard trigger:** the icon currently only has a `click`
   listener. Add `tabindex="0"`, `role="button"`,
   `aria-label="ReadFlow 章節導讀"`, and handle `Enter`/`Space` the
   same as click — right now the entire feature is unreachable
   without a mouse.

Both keep the existing visual language (`.readflow-page-icon`
circle); only the token colors move from ad hoc hex to `--rf-primary`
/ `--rf-surface`.

## Content structure (heading treatment)

Today's `renderMarkdown()` turns `**📖 章節大綱**` into an inline
`<strong>`, indistinguishable in weight from a bolded word inside a
sentence — no real hierarchy between "this is a section" and "this
word is emphasized." Extend it (small, targeted change, not a
rewrite): a line that is **only** a bolded label
(`/^\*\*(.+)\*\*$/` on its own line) renders as
`<h3 class="rf-section-heading">` instead of an inline `<strong>`,
styled `font-size: 15px; font-weight: 700; color: var(--rf-primary);
margin: 0 0 8px;` with `24px` top margin except on the first section.
Inline `**bold**` elsewhere in a sentence is untouched.

The 📖/📚/📝 emoji stay as-is here — they're LLM-generated *content*
inside a heading a user reads, not a *structural UI icon* standing in
for a control, so the "no emoji as icons" rule doesn't apply the way
it would to, say, the panel's close button.

## Open questions for implementation

1. Retry needs `pageCount` retained across the loading → error
   transition — trivial (one variable), but Task 6's current code
   doesn't have anywhere obvious to hold it since `onStartCapture`
   currently reads and discards the input value.
2. The 480px bottom-sheet breakpoint is a judgment call, not measured
   against real narrow-window usage — flagged as worth revisiting
   after the first round of manual testing in Play Books, the same
   way the plan already flags the page-turn mechanism as unverified.
