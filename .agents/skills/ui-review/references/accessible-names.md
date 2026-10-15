# Accessible-name markup

What the accessibility tree says about each control and graphic, read against what the screen shows, and the order in which the keyboard reaches them.

## Rule

- **WCAG 2.2 2.5.3 Label in Name (A).** A control with a visible text label has an accessible name that contains that text. The bar is strict: the visible string as shown, symbols and punctuation included, so a «+3» chip named "Show 3 more" fails. Named heuristic: the name starts with the visible label.
- **WCAG 2.2 4.1.2 Name, Role, Value (A).** Every control has a name, the right role, and its state (checked, expanded, selected) in the tree.
- **WCAG 2.2 2.4.6 Headings and Labels (AA).** A name says what the control is for: a bare value («72 %») without what it measures is not enough.
- **WCAG 2.2 1.1.1 Non-text Content (A)** and **decorative graphics are hidden** (named heuristic). A decorative icon, or a glyph that repeats a state the control already exposes (a tick inside a checked checkbox), is hidden from the tree: `aria-hidden="true"`, an empty `alt`, no `<title>`.
- **WCAG 2.2 3.1.2 Language of Parts (AA).** A name in another language than the page's carries its own `lang`. A control named in another language than its visible label is a finding.
- **Words are not glued** (named heuristic). Parts shown apart on screen keep a separator in the name: «Storage» and «72 %» do not read «Storage72 %».
- **Nothing is announced twice** (named heuristic). A name does not repeat itself (visible text plus an `aria-label` saying the same thing, an icon title plus the text).
- **WCAG 2.2 2.4.3 Focus Order (A).** Tab order follows the visual order: a dialog's close button shown first is not reached last.
- **The engine matters.** Chromium computes a name from the DOM and the CSS: inline parts separated only by a margin come out glued, while flex or grid children get a space. Chromium does not prove what VoiceOver or NVDA reads: every finding of this class names Chromium, and the screen-reader check goes to the manual checks.

## Project override

In `brain/chore/ui-review.md` → Project bar:
- the page language, and the languages allowed in names;
- names that may differ from their visible label by design (an icon-only control with an established name), each listed;
- the label-in-name reading (strict by default).

## Proof and evidence

- **The tree:** a full `agent-browser snapshot -s "<scope>"` of every scope, in every forced state. Not `-i`, which hides images and static text. Read each control's name beside its visible text nodes, and look for `image` nodes next to controls.
- **The language:** `eval` of `document.documentElement.lang`, and the `lang` of the control's ancestors.
- **The order:** a Tab walk, `press Tab` then `eval` of `document.activeElement.outerHTML.slice(0, 120)` (wrapped in a function) after each press, compared with the visual order on a screenshot.
- **axe:** `button-name`, `label`, `image-alt` and `svg-img-alt` (`role="img"` only) are candidates. `label-content-name-mismatch` runs only when named in `rules`, and it ignores punctuation, so its pass does not settle 2.5.3.
- **Evidence:** the tree line (role, name, state) and the visible text beside it, quoted; the expected name.
- **Finding line:** location (selector, state) · Chromium version · the name read → the expected name · the rule · one fix (start the name with the visible text; `aria-hidden` on the decorative icon; a visually hidden separator or context in the label).
