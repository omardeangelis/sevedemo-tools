# Browser and device rendering

Defects that only one engine or one kind of device shows: Safari's focus behaviour, the virtual keyboard, Safari's toolbars and the safe areas, and touch input. Desktop Chromium hides all of them, so every finding of this class names the engine its evidence came from.

## Rule

- **Focus after a click follows the engine** (named heuristic). Safari, on macOS and iOS, and Firefox on macOS do not focus a button when it is clicked; Chromium does. Code that reads `document.activeElement` after a click, or moves focus relative to it ("to the next remove button"), breaks there while Chromium hides it.
- **The virtual keyboard leaves the field and its action visible** (named heuristic). On a touch device, opening a surface does not autofocus a text field, which raises the keyboard; when the user focuses a field, the field and its primary action stay above the keyboard. No WCAG criterion covers it: 2.4.11 is about the page's own content, not the system keyboard.
- **Toolbars and safe areas leave fixed actions clear** (named heuristic). A fixed or sticky action stays clear of Safari's bottom bar and of the home indicator (`env(safe-area-inset-*)`), and a full-height surface uses the dynamic viewport units (`dvh`, `svh`) rather than `100vh`, which is taller than the visible area while Safari's bars show.
- **Touch is checked on a touch engine** (named heuristic). Styles under `(pointer: coarse)` or `(hover: none)`, and touch handlers, are judged on a device or the Simulator: `set device` gives no touch.

## Project override

In `brain/chore/ui-review.md` → Project bar:
- the engines and devices the project supports (default: current Chromium, plus Mobile Safari when the Simulator is installed);
- whether the project is touch-first, which also raises the target size to 44 or 48 px;
- components that autofocus on purpose, each with its reason.

## Proof and evidence

- **The device route** (SKILL.md → Device route) decides the engine.
  - **Simulator installed:** a full-screen screenshot of the defect (the action under the toolbar or the keyboard), opened, and `eval` of `document.activeElement` after the click or tap. Engine: Mobile Safari (Simulator) with its iOS version.
  - **Otherwise:** a "not verified on device" entry: the code hypothesis with `file:line` (an `autofocus`, a focus call on open, `100vh`, a focus move that reads `document.activeElement`), and the exact manual check. No measured value.
- **What Chromium can show** is a precondition, never the defect: for example, `document.activeElement` is the text field right after opening. Cite it as the precondition, next to the code line.
- **The keyboard** probably stays "not verified on device" even in the Simulator, because `agent-browser` taps are script clicks, which do not raise it. Give the manual check (a real tap on the device or in the Simulator, then what to look for).
- **Finding line:** location (selector, state, width range) · engine · what the screenshot or the code shows → what the rule needs · the rule · one fix (no autofocus on touch; `dvh` units; padding with `env(safe-area-inset-bottom)`; focus the next control explicitly instead of reading `document.activeElement`).
