# Responsive widths and wrapping

How a surface holds across the width range: rows that wrap where the design does not allow it, horizontal overflow, text that collides or is cut, and geometry that stays stale after the viewport changes.

## Rule

- **WCAG 2.2 1.4.10 Reflow (AA).** At 320 CSS px wide, content and functions stay available with vertical scrolling only. Content that needs two dimensions (a data table, a map, a code block) may scroll inside its own region.
- **The row contract holds at every width** (named heuristic). A component designed for a fixed number of rows (a tag preview, a toolbar, a tab bar, a button group) keeps that number at every width of the range, not only at common device widths. A wrap that appears in one narrow band of widths is a defect even when the band is a few pixels wide.
- **Geometry follows the viewport** (named heuristic). An open overlay, drawer or card that is resized matches a fresh load at the new width. One that keeps the width or position it computed at opening is stale.
- **Text fits at the densest realistic content** (named heuristic). With the longest values the data allows, labels and values neither collide nor clip. Truncation is fine when it is designed (an ellipsis).
- **Larger text survives** (named heuristic). The sweep at 1.25 × the root font size keeps the contracts above. It is a robustness check, not a test of 1.4.4 Resize Text or 1.4.12 Text Spacing: those need their own check (text at 200 %, or the text-spacing overrides injected and the surface inspected for clipping), and are listed under Not tested otherwise.

## Project override

In `brain/chore/ui-review.md` → Project bar:
- the minimum width (default 280 px) and the maximum (default: the widest breakpoint the CSS defines, else 1440 px);
- the row contract of named components (for example, "tag preview: at most two rows");
- regions that are two-dimensional by design and may scroll sideways;
- the densest realistic content, when neither the data model, the fixtures nor the spec give it.

## Proof and evidence

- **Densest content first.** Before sweeping, inject the longest realistic values with `eval` (wrapped in a function): the longest names the data model allows, or that the code, fixtures or spec show. Record what was injected; a sweep with short fixture names proves nothing.
- **Width sweep:** `width-sweep` on each row container of the surface, in every forced state.
  - Evidence: the range `from`–`to`, `rows`, `containerWidth` at both ends, `overflowX`, the font-scale pass it came from, and a screenshot at one width inside the range, opened.
  - Report the range and the container's own width, never a single viewport width.
  - When `unreadableSheets` is above 0, pass the project's breakpoints in `breakpoints`.
- **Overflow:** `overflowX: true` on a range, confirmed by a screenshot showing the cut or the sideways scroll.
- **Resize:** `resize` on every overlay, drawer or card that computes its geometry when it opens, from the widest to the narrowest width, with `shots` set.
  - Evidence: the `resized` and `fresh` boxes, the `delta`, `pastViewport`, and both screenshots, opened.
  - `matchesFresh: true` is clean.
- **Finding line:** location (container selector, state, width range, font scale) · Chromium version · measured rows, overflow or delta → the contract · the rule · one fix (reserve room for the overflow chip; size from CSS rather than from a measurement at open; `min-width: 0` on the flex child).
