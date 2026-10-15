# Target size and hit area

What responds to a pointer: how large it is, and whether it matches what looks clickable.

Target size belongs to the `ui-review` bar: 24 px by default, 44 or 48 px when the project says touch-first (`brain/chore/ui-review.md` → Project bar).

## Rule

- **WCAG 2.2 2.5.8 Target Size (Minimum) (AA).** A pointer target is at least 24 × 24 CSS px, or spaced so that a 24 px circle centred on it touches no other target. Exempt: links inside a sentence, a control with an equivalent elsewhere, a browser default control, and a size that is essential.
- **The project's standard.** The responding box meets the Project bar's target size: 24 px by default, 44 or 48 px when the project says touch-first. WCAG 2.2 2.5.5 Target Size (Enhanced) (AAA) is the 44 px level.
- **The hit area equals the hover area** (named heuristic). Whatever highlights, changes the cursor, or reads as one control responds to a click over all of it. A row that highlights as a whole but toggles only on its label has dead padding, and its real target is the label.
- **axe proves little here.** Its `target-size` rule is off by default, and it passes a small target that has spacing around it, so an axe pass says nothing about the project's standard.

## Project override

In `brain/chore/ui-review.md` → Project bar:
- the target-size standard (24 px by default; 44 or 48 px when the project says touch-first);
- components where a smaller target is accepted (dense data tables, for example), each with its reason.

## Proof and evidence

- **Find the hover box.** The element that highlights: `hover <sel>`, then compare its computed background or cursor with the resting one (read with `eval`, wrapped in a function). A row, card or list item that highlights as a whole is the `hover` argument; the input or button inside is the `control`.
- **The probe:** `hit-area` on every control whose hover box is larger than its responding part, and on every small control, with `standard` from the Project bar.
  - Evidence: `coverage` with the `hoverBox`, `respondingSize` against `standard` (`meetsStandard`), the sampled `clicks` (`responded`, `toggled`), `clicksAgree` and `stateRestored`.
  - Report the size of the responding box, not of the visible box.
- **Disagreement:** `clicksAgree: false` means the grid and the real clicks differ (a layer intercepts, or a handler sits on an ancestor). Find out why before reporting either.
- **State left changed:** `stateRestored: false` means the page is no longer in the state you forced. Reload or force it again before the next probe.
- **Finding line:** location (control and hover selectors, state, width) · Chromium version · coverage and responding size → the hover box and the standard · the rule · one fix (wrap the whole row in the `<label>`, or give the control the row's padding).
