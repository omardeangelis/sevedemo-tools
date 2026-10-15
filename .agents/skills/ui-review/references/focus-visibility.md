# Focus visibility

Whether a keyboard user can see where focus is: an indicator on every focusable control, whole, not covered, and drawn around what the control really is.

## Rule

- **WCAG 2.2 2.4.7 Focus Visible (AA).** Every keyboard-operable control shows a visible focus indicator. It fails when the indicator is absent or entirely hidden.
- **WCAG 2.2 2.4.11 Focus Not Obscured (Minimum) (AA).** The focused control is not entirely hidden by the page's own content: a sticky header, a fixed footer, a banner. 2.4.12 (AAA) asks that no part be hidden.
- **WCAG 2.2 1.4.11 Non-text Contrast (AA).** The indicator reaches 3:1 against the colours next to it.
- **The ring is fully visible** (named heuristic). No part of the indicator is cut by an ancestor's `overflow` or covered by a fixed or sticky layer. A partly clipped ring fails no AA criterion on its own; report it under this heuristic.
- **The ring encloses the hit area** (named heuristic). The indicator surrounds what responds to a click (the control together with its label or row), not a smaller part of it, such as the 16 px box of a row that toggles as a whole.
- **WCAG 2.2 2.4.13 Focus Appearance (AAA)** (the indicator's area, and the contrast change between the focused and unfocused states) applies only when the Project bar asks for it.
- **Keyboard only.** `:focus-visible` styles appear after keyboard input, so every control is reached with real Tab presses, in every forced state.

## Project override

In `brain/chore/ui-review.md` → Project bar:
- the project's focus style (for example, a 2 px ring with a 2 px offset in a named token), checked as a design-system rule;
- components that show focus another way by design (a background change, an underline): the crop diff must still show a visible change;
- AAA (2.4.12, 2.4.13) when the project says.

## Proof and evidence

- **The probe:** `focus-ring` with `scope` set to the surface (or `controls`), in every forced state, with `shots` set.
- **No indicator:** `ringKind: none` with `cropDiffPct` near 0 is a 2.4.7 candidate. Open both crops before reporting. A `ringKind: none` with a clear `cropDiffPct` means focus shows some other way: open the crops and judge whether the change is visible.
- **Clipped:** `clippedFraction` above 0, with `clippedPx` (the sides cut) and `clipAncestor`, and the focused crop showing the cut.
- **Covered:** `obscuredFraction` above 0, with `obscuredBy`. When the whole control is covered, it is 2.4.11; when part of it is, it is the "fully visible" heuristic.
- **Smaller than the target:** `enclosesTarget: false`, with the `ring` and `target` rects and `ringOwner`.
- **Indicator contrast:** take the ring colour from `ringStyle`, the background behind it from `contrast` on the neighbouring element, and compute the ratio with `node -e`; give both colours.
- **Not reached:** `reached: false` means Tab never landed on the control (`tabbable: false`, or the `active` element that took focus instead). A control that should take focus and does not is a markup finding (its role or `tabindex`): confirm it with a Tab walk and report it under accessible-name markup.
- **Finding line:** location (control selector, state, width) · Chromium version · ring kind, the clipped sides or fraction, or the ring rect against the target rect → a whole ring around the target · the rule · one fix (padding inside the clipping ancestor, an inward `outline-offset`, the ring on the row through `:has(:focus-visible)`).
