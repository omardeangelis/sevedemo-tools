# Contrast

Text and the visual parts of controls against what is actually behind them, in every state and theme.

## Rule

- **WCAG 2.2 1.4.3 Contrast (Minimum) (AA).** Text, and images of text, reach 4.5:1 against their background. Large text reaches 3:1: at least 24 px, or at least 18.66 px when bold. Disabled controls, pure decoration and logotypes are exempt.
- **WCAG 2.2 1.4.11 Non-text Contrast (AA).** The parts needed to identify a control or its state (a field's border, a checkbox's box, a selected tab's marker, a meaningful icon) reach 3:1 against the colours next to them.
- **Every state and every theme.** Default, hover, focus, selected, error, and each theme the project ships. A colour that passes at rest can fail on hover or in the dark theme.
- **Measured, never estimated** (named heuristic). A ratio comes from the probe or from axe, computed against the composited background. It is never read off a screenshot by eye, inferred from a token name, or taken from the element's own background colour, which is often transparent.
- **WCAG 2.2 1.4.6 Contrast (Enhanced) (AAA)** applies only when the Project bar asks for it.

## Project override

In `brain/chore/ui-review.md` → Project bar:
- the conformance level (AA by default; AAA when the project says);
- the themes the project ships, and how to switch a class-based theme (a `cli` or `js` theme for the probe);
- extra states to check on given components.

## Proof and evidence

- **Text:** `contrast` on every text element of the surface, in each state and theme.
  - Evidence: `ratio` against `required`, `color`, the composited `background` and `backgroundFrom`, `fontSizePx` and `fontWeight`, the state and the theme.
  - `needsReview: true` (a gradient, an image, opacity, a filter, a blend mode or a text shadow on the way) means the ratio covers the colour layers only. Take a cropped screenshot, open it, and report what it shows, or an open question; never the computed number as fact.
- **Icons:** an icon drawn in `currentColor` can be a `contrast` target; judge its ratio against 3:1, not the `required` the probe prints for text.
- **Borders and other boundaries:** the probe measures text colour only. Read the boundary colour with `eval` (for example `getComputedStyle(el).borderTopColor`), take the background from the probe's `background` for the element next to it, and compute the WCAG ratio with `node -e`. Give both colours with the ratio. Without that, list the boundary under Not tested.
- **axe:** a `color-contrast` violation is a candidate; re-measure it with the probe in the same state and theme before reporting. Its "needs review" contrast items go to the probe or a screenshot.
- **Finding line:** location (selector, state, theme) · Chromium version · measured ratio (colour on background) → the required ratio · 1.4.3 or 1.4.11 · one fix (the nearest token that passes, or an opaque background behind the text).
