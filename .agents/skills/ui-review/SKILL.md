---
name: ui-review
description: The bar and the tested probes for reviewing the static UI of a rendered page — placement and geometry, responsive widths and wrapping, contrast, focus-indicator visibility, target size and hit area, accessible-name markup, and browser and device rendering — measured in a real browser with `agent-browser` before anything is judged. Its users are the `ui-reviewer` agent (prototype review and live-surface review) and the UI pass that `adversarial-verifier` runs inside `adversarial-review`. Use when reviewing or verifying how a rendered page, prototype or component looks and responds at rest — a focus ring that is clipped, missing or smaller than the control, a row that wraps only at some widths, an overlay pressed against the viewport edge or stale after a resize, text below its contrast ratio, dead padding in a row that highlights as a whole, a target below the project's size, an accessible name that differs from the visible label, content that jumps with nothing animating. Not for UX (`ux-advisor`) or motion and interaction craft (`design-engineer`).
---

# UI review

The bar for the static UI of a rendered surface, and the probes that measure it. Measure first, then judge: a finding rests on a probe result, a tree read or an opened screenshot from the same run, never on a guess.

## Contract

- **Role:** the static-UI bar (seven classes, one page each under `references/`) and the scripts that measure it
- **Entrypoint type:** model-invocable reference with scripts; no workflow of its own beyond the run order below
- **Consumers:** the **`ui-reviewer`** agent, at the prototype review (`prototype` Phase 6) and the live-surface review; the **UI pass** of `adversarial-review`, run by `adversarial-verifier` (see "The UI pass in `adversarial-review`")
- **Delegates to:** nothing. UX goes to `ux-advisor`, motion and interaction craft to `design-engineer`
- **Writes:** nothing in the project. Screenshots and probe output go to an absolute temporary folder outside the project tree
- **Never:** downloads or installs anything during a review: no CDN script, no package, no device tooling

## Before the first command

1. Before the first `agent-browser` command, run `agent-browser skills get core` and follow it: it is the usage guide for the installed version.
2. Read `brain/brain.config.json` (keys in `brain/AGENTS.md` → Project configuration). If it is absent, use the defaults listed there.
3. Read `brain/chore/ui-review.md` when it exists:
   - **Project bar:** minimum width, target-size standard, supported engines and devices, design-system rules. Each value replaces the default this skill gives;
   - **Component traps:** known quirks of the project's components;
   - **Kept examples:** findings that changed the product, as calibration;
   - **Suppressed findings:** never report one again.

   Without the page, the defaults of this skill apply.
4. `<skillsDir>` below is where the skills are installed: the `skillsDir` in `brain/.brain-manifest.json` (`.agents/skills` by default), or the `--skills-dir` given to `brain install-skill`.
5. Create the run's folder with `mktemp -d` and use its absolute path for every screenshot and every `shots` argument.
6. Without `agent-browser` on `PATH`, open the review with a `DEGRADED` banner and give code-grounded hypotheses only, with no measured value.

## Ownership

| Concern | Owner |
|---|---|
| UX: tasks, outcomes and states, leaving and interrupting, what the copy means, focus after an action, announcements | `ux-advisor` |
| Static UI of the rendered page: placement, widths and wrapping, contrast, focus-indicator visibility, target size and hit area, accessible-name markup, browser and device rendering, instant re-layouts with nothing animating | `ui-reviewer` (review); the `ui-review` skill (bar and probes) |
| Motion and interaction craft: anything that changes while an animation or transition runs on the surface, reduced motion, gestures | `design-engineer` / `design-engineering` |
| Aesthetic direction, typography and colour choices | the project's brand or frontend-design guidance; `prototype` explores directions |

If it changes while an animation or transition runs on the surface, it is motion; an instant re-layout with nothing animating is UI. A header that grows in one frame while its container animates is motion. A centred dialog that jumps when a row is removed, with nothing animating, is UI.

Target size belongs to the `ui-review` bar: 24 px by default, 44 or 48 px when the project says touch-first (`brain/chore/ui-review.md` → Project bar).

## The bar

One page per class. Each gives the rule and its source (a WCAG 2.2 criterion or a heuristic named there), what the Project bar may override, and the probe or tree read that proves it, with the evidence a finding carries.

| Class | Page | Main sources | Proved by |
|---|---|---|---|
| Placement and geometry | [placement-and-geometry.md](references/placement-and-geometry.md) | overlay keeps its edge margin; no instant jump; 1.4.10 | `edge`, `layout-jump`, cropped screenshot |
| Responsive widths and wrapping | [widths-and-wrapping.md](references/widths-and-wrapping.md) | 1.4.10; the row contract holds at every width; geometry follows the viewport | `width-sweep`, `resize` |
| Contrast | [contrast.md](references/contrast.md) | 1.4.3, 1.4.11 | `contrast`, axe as second opinion |
| Focus visibility | [focus-visibility.md](references/focus-visibility.md) | 2.4.7, 2.4.11, 1.4.11; the ring is fully visible; the ring encloses the hit area | `focus-ring` |
| Target size and hit area | [target-size-and-hit-area.md](references/target-size-and-hit-area.md) | 2.5.8; the project's standard; the hit area equals the hover area | `hit-area` |
| Accessible-name markup | [accessible-names.md](references/accessible-names.md) | 2.5.3, 4.1.2, 1.1.1, 2.4.6, 3.1.2, 2.4.3 | full `snapshot -s`, Tab walk, axe |
| Browser and device rendering | [browser-and-device.md](references/browser-and-device.md) | named engine heuristics | device route, or "not verified on device" |

**Defaults** (each one overridable in the Project bar): widths from 280 px to the widest breakpoint the CSS defines (1440 px when none); target size 24 px; every theme the project ships; Chromium, plus Mobile Safari when the Simulator is installed.

**Run order.** For each forced state of the surface, with the densest realistic content injected (the longest values the data model, fixtures or spec allow):
1. run the probes of every class;
2. read the full accessibility tree of each scope;
3. run axe when a source exists;
4. open and inspect every screenshot the review relies on, taken at a known pixel ratio;
5. take the device classes through the device route;
6. pass every candidate through the evidence gate, then the falsification pass.

## Running the probes

```
bash <skillsDir>/ui-review/scripts/probe.sh <probe> '<json-args>' [--session <name>]
```

- **Always through `bash`.** Installed files are written without the exec bit, so running a script directly fails in projects.
- **The page:** the probe runs on the page already open in the session. Open it first with `agent-browser --session <name> open <url>`. Without `--session`, the default session is used.
- **Sessions:** one per reviewer, named for the run, and closed at the end with `agent-browser --session <name> close`. Two reviewers in parallel never share one.
- **Arguments:** one JSON object, single-quoted. Selectors are CSS selectors. `node` parses them, so `node` must be on `PATH`.
- **Output:** exactly one JSON document on stdout, with `probe` set. A failure prints `{"probe", "error"}` and exits 1: report the error, never a value it did not return.
- **Viewport and state:** every probe restores the viewport. `resize` and `edge` reload the page, so a state forced in memory is lost: reach it through the trigger list or the URL, and force it again before the next probe.
- **Screenshots:** `shots` is an absolute folder; a relative path is refused.
- **How it works:** each probe has an in-page half, `probes/<probe>.js`, a function the runner wraps and pipes to `agent-browser eval --stdin`. The runner drives the viewport, the reloads, the Tab presses and the clicks.

### `width-sweep` (`probes/width-sweep.js`)

`bash <skillsDir>/ui-review/scripts/probe.sh width-sweep '{"targets": ["<container>"], "min": 280, "max": 1440}'`
- **Args:** `targets` (required: containers whose children form rows); `min` (280); `max` (1440); `height` (800); `breakpoints` (default: read from the stylesheets' media queries); `fontScale` (1.25; `false` skips the second pass); `settle` (ms, 0).
- **What it does:** steps of at most 16 px below 480 px and 60 px above, every breakpoint ±1 px, a binary search down to 1 px wherever a row count or box signature changes, then the whole sweep again at `fontScale` × the root font size.
- **Returns:** `passes[]`, one per font scale, each with `targets[].ranges[]`: `{from, to, rows, containerWidth: [at from, at to], overflowX}`. Also `breakpoints`, `breakpointSource`, and `unreadableSheets` (cross-origin sheets: pass `breakpoints` yourself).

### `resize` (`probes/resize.js`)

`bash <skillsDir>/ui-review/scripts/probe.sh resize '{"trigger": "<sel>", "overlay": "<sel>", "wide": 1440, "narrow": 280, "shots": "/abs/dir"}'`
- **Args:** `trigger` (a selector, or a list clicked in order); `overlay` (required); `wide` (1440); `narrow` (280); `height` (800); `settle` (300 ms); `shots`.
- **What it does:** reloads at the wide width and opens the overlay, resizes to the narrow width, then reloads there and opens it again.
- **Returns:** `opened`, `resized` and `fresh`, each `{viewport, visible, box}`; `delta` (resized − fresh); `matchesFresh` (within 1 px); `pastViewport: {resized, fresh}`; `shots`.

### `edge` (`probes/edge.js`)

`bash <skillsDir>/ui-review/scripts/probe.sh edge '{"trigger": "<sel>", "overlay": "<sel>", "viewport": [375, 667], "shots": "/abs/dir"}'`
- **Args:** `trigger` and `overlay` (required); `viewport` (`[w, h]`, default the current one); `inset` (8: the trigger's distance from the edge); `placements` (`top`, `middle`, `bottom`); `settle` (0); `reload` (true); `shots`.
- **What it does:** for each placement, reloads, scrolls the trigger to that position, clicks it and measures the overlay.
- **Returns:** `viewport`, and `placements[]`: `{placement, reached, trigger, visible, overlay, distance: {top, right, bottom, left}, coversTrigger, shot}`. A negative distance is past the edge.

### `focus-ring` (`probes/focus-ring.js`)

`bash <skillsDir>/ui-review/scripts/probe.sh focus-ring '{"scope": "<surface>", "shots": "/abs/dir"}'`
- **Args:** `controls` (a list of selectors), or `scope` (default `body`: every tabbable control inside it, in Tab order); `maxTabs` (3); `shots`.
- **What it does:** reaches each control with real `press Tab` presses, takes a screenshot, blurs it (focus moves to the body), takes a second one, and compares the two crops.
- **Returns,** per control: `reached` and `focusVisible`; `ringKind` (`outline`, `box-shadow` or `none`); `ringOwner` (the control, or the label or ancestor whose ring appears only with focus); `ring`, `ringWidth`, `ringStyle`; `clipAncestor`, `clippedPx` and `clippedFraction`; `obscuredFraction` and `obscuredBy` (fixed or sticky layers); `target` (the control and its labels) and `enclosesTarget`; `cropDiffPct`, with the kept crops under `shots`. A control not reached gives `reached: false`, with `tabbable: false` or the `active` element that took focus.

### `hit-area` (`probes/hit-area.js`)

`bash <skillsDir>/ui-review/scripts/probe.sh hit-area '{"control": "<input>", "hover": "<row>", "standard": 24}'`
- **Args:** `control` (required: the input or button); `hover` (what looks clickable, the element that highlights; default the control); `standard` (24; pass the Project bar's); `step` (4 px); `clicks` (at most 8).
- **What it does:** samples `elementFromPoint` on a grid over the hover box, with no clicks, then confirms with real mouse clicks at the centre and at points inside and outside the responding region, clicking again wherever the state toggled.
- **Returns:** `hoverBox`, `coverage` (the share of the hover box that responds), `respondingBox`, `respondingSize`, `respondingElements`, `meetsStandard`, `clicks[]` (`{x, y, where, expected, responded, toggled, restored}`), `clicksAgree` and `stateRestored`.

### `contrast` (`probes/contrast.js`)

`bash <skillsDir>/ui-review/scripts/probe.sh contrast '{"targets": ["<text>"], "states": ["default", "hover", "focus"], "themes": ["light", "dark"]}'`
- **Args:** `targets` (required: text elements); `states` (default `["default"]`; `hover`, `focus` through a real Tab, or `{"name", "cli" | "js"}` for any other state); `themes` (`light` and `dark` set `prefers-color-scheme`; `{"name", "media", "cli" | "js"}` switches a class-based theme; default the current one); `maxTabs` (3).
- **What it does:** composites the background through every ancestor, per theme and state. A media theme is restored afterwards; a `cli` or `js` theme is yours to undo.
- **Returns:** `measurements[]`, one per theme × state × target: `selector`, `theme`, `state`, `text`, `color`, `background`, `backgroundFrom`, `ratio`, `fontSizePx`, `fontWeight`, `large`, `required`, `passes`, `needsReview` and its `reasons`.

### `layout-jump` (`probes/layout-jump.js`)

`bash <skillsDir>/ui-review/scripts/probe.sh layout-jump '{"watch": ["<dialog>", "<action>"], "action": {"cli": "click <sel>"}}'`
- **Args:** `watch` (selectors whose boxes are compared); `action` (required: `{"cli": "<agent-browser subcommand>"}` or `{"js": "<page expression>"}`; it must not navigate or reload, which drops the observer); `settleMs` (600).
- **What it does:** installs a layout-shift observer and a per-frame log of running animations, runs the action, waits, and reads both.
- **Returns:** `shifts[]` (`{at, value, hadRecentInput, animating, animations, sources[]}`), `instant` and `animated` counts, `boxes[]` (`{selector, before, after, delta}`), and `runningElsewhere` (unrelated animations, such as a spinner, which do not count).
- **Limit:** the layout-shift API reports nothing for `transform` or `opacity` animations. A shift during an animation proves motion; a transform-only animation shows no shift at all, so "no shift" does not prove "no motion".

### `axe.sh`

`bash <skillsDir>/ui-review/scripts/axe.sh '{"scope": "<sel>", "rules": ["color-contrast"], "project": "/abs/project/root"}' [--session <name>]`
- **Args:** `scope` (default the document); `tags` (WCAG tags such as `wcag2a`, `wcag2aa`, `wcag22aa`); `rules` (rule ids: the injected axe runs exactly these, while `a11y` only filters its results by them, so widen its run with `tags`); `project` (absolute, default the working directory). The `AXE_CORE_DIR` environment variable points at a folder holding `axe.min.js`.
- **Returns:** `{source, version, scope, violations[], needsReview[]}`, each item with `id`, `impact`, `help` and `nodes[]` (`target`, an `html` excerpt, `failureSummary`, and check `data` such as the colours and ratio). With no source: `{"source": "none", "agentBrowser": "<version>", "looked": [...]}`.

### The fixture self-check

[fixture/index.html](fixture/index.html) reproduces each probe's defect next to a clean twin, and [fixture/expected.json](fixture/expected.json) holds each probe's arguments and expected result there (headless Chromium, pixel ratio 1). When a result looks wrong (an error, a ring reported missing that you can see, a sweep with no change where you saw one), run the same probe on the fixture in a session of its own:

```
agent-browser --session ui-fixture open "file://<absolute skillsDir>/ui-review/fixture/index.html"
bash <skillsDir>/ui-review/scripts/probe.sh focus-ring '{"controls": ["#ring-outline-defect", "#ring-outline-clean"]}' --session ui-fixture
agent-browser --session ui-fixture close
```

If the fixture disagrees with `expected.json` (±1 px), the probe or the CLI version is at fault: report that class under Not tested, with the reason, and state no number from it. If the fixture agrees, the surface is the cause: look again.

## Driver traps

| Trap | Workaround |
|---|---|
| `focus <sel>` does not trigger `:focus-visible`, so no ring is painted | Reach controls with real `press Tab`; `focus-ring` does |
| `vitals` reloads the page: forced state, injected scripts and axe are gone, and its CLS ignores shifts that follow input | Measure jumps with `layout-jump`; after `vitals`, force the state again and re-run `axe.sh` |
| A relative screenshot path resolves against the daemon's folder, not yours | Absolute paths only, inside the run's temporary folder |
| `eval` keeps top-level `const` and `let` between calls | Wrap every ad-hoc script in a function and call it; the probes do |
| `eval` prints a returned `JSON.stringify` string as a quoted literal | Return a plain object |
| `get styles` dumps about 400 properties and only the element's own background, often transparent | Use `contrast`, which composites the ancestors |
| `set device` sets the viewport, pixel ratio and user agent, but no touch | Claim no touch behaviour from it; device classes take the device route |
| With `outline: none`, Chromium still reports an outline width | Read `outlineStyle` first; `focus-ring` counts an outline only when its style is not `none` |
| After a reload the scroll position is restored, and `click` on an element outside the viewport reports success without hitting it | `scrollintoview <sel>` before every `click`; the runner does |
| `screenshot "<sel>" <path>` captures the wrong region once the page is scrolled | Take viewport screenshots and crop them; `focus-ring` crops in `node` |
| `diff screenshot -s <sel>` fails, or reports every pixel changed against a full-viewport baseline | Compare two shots of the same scope only, or use `focus-ring`'s crop diff |
| A headless session's `prefers-color-scheme` follows the OS | Set it per theme with `set media light` or `set media dark`; `contrast` sets and restores it |
| `snapshot -i` hides images and static text, and does not mark the focused element | Read names from a full `snapshot -s "<scope>"`; read focus with `eval` of `document.activeElement` |
| During a `height` transition, Chromium names the displaced sibling as the shift source and stops reporting moves under about 3 px late in the transition | `layout-jump` relates a layout-property animation on a sibling subtree; read `boxes` for the final positions, not the last shift |

## axe

- **Role:** a second opinion and a source of "needs review" items, never the only check, and it never replaces a probe. Its violations are candidates that pass the evidence gate like any other finding; its "needs review" items go to the `contrast` probe or a screenshot.
- **Source, in order (`axe.sh` picks it):**
  1. `agent-browser a11y`, on 0.33.0 or later (it does not run on iOS sessions);
  2. the project's own `node_modules/axe-core/axe.min.js` (or `$AXE_CORE_DIR/axe.min.js`), injected with `eval --stdin`;
  3. none: the contrast probe still runs, and Engines says "axe not available".
- **Never** from a CDN, and never installed.
- **Re-inject** after any navigation, reload (`resize` and `edge` reload) or `vitals`: run `axe.sh` again, which injects whenever `window.axe` is missing. Run it once per forced state, scoped to the surface.
- **What it cannot see:** no rule tests focus indicators; `target-size` is off by default and passes a small target that has spacing around it; `label-content-name-mismatch` is experimental, off by default and ignores punctuation; `svg-img-alt` checks only SVGs with `role="img"`. Name a rule in `rules` to run it.

## Device route

- **What needs a real engine:** Safari's focus behaviour (it does not focus a clicked button), the virtual keyboard, Safari's collapsing toolbars and the safe areas. Desktop Chromium shows none of them.
- **The installed-check:** `appium` is on `PATH` (`command -v appium`), and `appium driver list --installed` lists `xcuitest`. Both must hold.
- **When it holds:** review in Mobile Safari in the iOS Simulator, `agent-browser -p ios --device "<name>" open <url>` (names from `agent-browser device list`).
- **Otherwise never run `-p ios`:** its launcher may download Appium. Never install Appium, the driver, or any other device tooling.
- **What the Simulator adds:** real Mobile Safari, with screenshots of the whole screen, status bar and Safari's bars included, so a fixed action under the toolbar shows; Safari's focus-on-click behaviour; `eval`, `screenshot`, `click` and `snapshot -i`.
- **What it does not add:** taps are script clicks, so the keyboard probably still does not rise; the snapshot is built from the DOM, not from what VoiceOver reads; `a11y` and `network route` are unavailable; the probes target Chromium, so measure there with `eval` and screenshots.
- **"Not verified on device" format,** for each device finding without the Simulator, with no measured value:

  ```
  - <selector> · <state> · <width range> — not verified on device (<engine it needs>)
    Hypothesis: <what fails and why> (<file>:<line>)
    Manual check: <browser and device> → <exact steps> → <what to look for>
  ```

## Evidence gate

Every finding passes all of these; one that fails any becomes an open question with a default.
- [ ] **Location:** selector, state, and width range (the probe's range, not one width).
- [ ] **Engine:** Chromium with its version, Mobile Safari (Simulator), or code.
- [ ] **Measured value or screenshot** from this run: a probe result, a tree line, or an opened screenshot's path. A value that no output of the run contains is never stated. A code-grounded finding cites `file:line` instead.
- [ ] **Expected against actual.**
- [ ] **The rule:** a WCAG 2.2 criterion, a rule the Project bar states, or a heuristic named on a class page.
- [ ] **One fix.**
- [ ] **On screen:** an overlap or protrusion is reported only when a cropped screenshot shows it. Visible clipping in a screenshot is reported even when the numbers look fine.

## Falsification pass

Before reporting, for every finding that passed the gate:
- [ ] It is not an intentional region: a scroll area, a carousel, truncation by design, a decorative overflow.
- [ ] It is not in the Project bar's accepted exceptions or in Suppressed findings.
- [ ] It is not UX (task, outcome, what the copy means), not motion (it changed while something animated), and not taste.
- [ ] It reproduces: re-run the probe or re-open the screenshot once. A probe result that looks wrong goes through the fixture self-check.
- [ ] An axe violation was re-measured by a probe or a screenshot.
- [ ] Findings that share an element and a width range are merged into one.

## The UI pass in `adversarial-review`

`review-classifier` charters a UI pass when the change set holds rendered-UI code: markup, styles, tokens, ARIA or label attributes, inline SVG icons. `adversarial-verifier` runs it with this skill as its rubric and its probes.
- **The route:** the orchestrator starts or locates the dev server and passes the URLs in the brief. The verifier only drives `agent-browser` against them, in its own session. That stays within its read-only contract, DOM injection and `network route` mocks included; no file, server or data changes.
- **Case A (standalone review):** the bar, on the changed surface: the components and states the change touches, over the full width range.
- **Case B (spec implementation review):** the spec's UI acceptance criteria, **and** the bar on the changed surface, because the implementation can add defects the prototype did not have.
- **The same method:** the run order, the evidence gate and the falsification pass above. Each finding goes in the verifier's format with its location, engine, measured value against the required one, rule and fix.
- **Stay in the lane:** no UX and no motion findings. The motion-craft pass keeps motion and does not check target size.
- **Without a route** (no documented dev command, or it fails): the pass runs on the code only, opens with `DEGRADED`, and `REPORT.md` says why.
