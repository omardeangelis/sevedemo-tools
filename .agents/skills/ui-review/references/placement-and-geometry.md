# Placement and geometry

Where the boxes of a surface sit at rest: overlays against the viewport edges, boxes that overlap or stick out of their container, fixed layers over the content, and content that jumps when it changes with nothing animating.

## Rule

- **An overlay keeps its edge margin wherever its trigger sits** (named heuristic). A popover, menu, expanded card or sheet stays wholly inside the viewport, at least the edge margin away from each edge, whether its trigger sits at the top, the middle or the bottom of the viewport. Near an edge it flips or shifts; it is not clamped against the edge, and it does not cover its own trigger unless the design opens it in place.
- **No instant jump** (named heuristic). A content change (a row removed, a validation message, a late load) that moves other visible boxes while nothing animates is a UI defect: a centred dialog that re-centres on every height change. When an animation or transition runs on those boxes at that time, it is motion and belongs to `design-engineer`, not here.
- **Fixed layers leave the content usable** (named heuristic). A sticky header, fixed footer, banner or toolbar does not cover the primary action or the content it sits over, at any width of the range.
- **No unintended overlap or protrusion** (named heuristic). One box drawn over another, or out of its container, is a defect only when a cropped screenshot shows it. Geometry alone over-reports: transparent padding and `overflow: hidden` make boxes overlap that nobody can see.
- **WCAG 2.2 1.4.10 Reflow (AA)** applies when the placement cuts off content or a function at the minimum width.

## Project override

In `brain/chore/ui-review.md` → Project bar:
- the edge margin (default 8 px);
- the viewport sizes for edge placement (default: the minimum width at 667 px tall, and 1280 × 800);
- overlays that open in place over their trigger by design;
- a jump the project accepts goes to Suppressed findings, with its reason.

## Proof and evidence

- **Edge placement:** `edge` on every overlay of the surface, at each viewport size, with `shots` set.
  - Evidence: the placement, the side whose `distance` is under the margin (negative means past the edge), `coversTrigger`, and the screenshot of that placement, opened.
  - A placement with `reached: false` could not put the trigger there (a short page): say so rather than report the overlay.
- **Instant jumps:** `layout-jump` on every content change the surface allows, with the moved elements and the primary action in `watch`.
  - Evidence: the action, the shifts with `animating: false`, and the `boxes` deltas (for example the dialog's `y` and its Save button's `y`).
  - A watched box that moved with no shift recorded moved through `transform`, which the layout-shift API does not report: look for a running animation before calling it either way.
- **Fixed layers:** `get box` of the layer and of the covered element at the widths where they meet, plus a screenshot of the overlap, opened. For a focused control, `focus-ring` gives `obscuredFraction` and `obscuredBy`.
- **Overlap or protrusion:** both boxes (`get box`) and a cropped screenshot that shows it. Without the screenshot, there is no finding.
- **Finding line:** location (overlay selector, state, placement, width range) · Chromium version · measured distance or delta → the required margin, or no movement · the heuristic · one fix (flip or shift near the edge; anchor the dialog to the top instead of centring it; reserve the space before the change).
