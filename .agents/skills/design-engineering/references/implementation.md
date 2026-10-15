# Implementation

How to express the standards in code. Pick the tool with `library-pick.md` first; this file covers the mechanics and the traps of each route.

---

## CSS

### Transition or keyframes? Ask who drives the change

| Transition — the user drives it | `@keyframes` — the page drives it |
| --- | --- |
| Hover, click, toggle, any state change | Runs on its own (page intro, one-shot reveal) |
| May be interrupted or retargeted mid-flight | Loops forever (marquee, spinner) |
| | Needs several discrete steps (blink, pulse) |
| | Simple enter/exit that can never be interrupted |

Transitions interpolate from the *current* value, so un-hovering mid-flight glides back; keyframes restart from the first frame. That one property decides most cases.

### Transition rules

- **Put the `transition` on the element's resting rule**, not only inside `:hover`, or the way back snaps instantly.
- **Never `transition: all`.** List properties. When several properties share one timing: `transition: 180ms ease; transition-property: background-color, border-color, opacity;`
- **Spell out `ease`** even though browsers default to it — plenty of people believe the default is `linear`, and writing it signals a deliberate choice.
- **Put `transition-delay` on its own line** — a fourth value in the shorthand is easy to misread.
- Transitions handle enter animations too (with `@starting-style`), and they are the right choice when the end state can move mid-flight (a toast shifting because another arrived).

### Keyframe rules

- Use the `animation` shorthand for name, duration, and timing only; declare the rest as longhands.
- Omitted `0%`/`100%` frames use the element's own values — `@keyframes blink { 50% { visibility: hidden } }` is complete.
- `animation-fill-mode: forwards` keeps the end state (else it snaps back). `backwards` applies the first frame *before* a delayed start — the fix for a staggered element flashing its final state first. `both` does both.
- `animation-direction: alternate` makes a loop swing both ways; pausing (`animation-play-state: paused`) is something only keyframe animations offer.
- To replay a keyframe animation in React, give the element a new `key` so it mounts again (other stacks: the stack profile, row 9).
- If the keyframes keep growing more stages, switch tools — intricate sequences are easier in a JS library.
- Staggered CSS entrances: per-item delay from a variable, e.g. `animation-delay: calc(var(--i) * 50ms)` with `animation-fill-mode: backwards`.

### Entering without JS

`@starting-style` declares the state an element is born in, so a plain transition animates its entrance (example in `standards.md` §6). Fallback: set a `data-mounted` attribute after first paint and drive the target state from it. Exits: primitive libraries keep the element mounted while an exit plays and expose state attributes (`data-state="open|closed"`, `data-starting-style`, `data-ending-style`) to style against. Once one tooltip is open, siblings should open instantly (Base UI exposes `data-instant` → `transition-duration: 0ms`).

### `clip-path`

Like `transform`, it never affects layout and is hardware-accelerated, so it's often the better reveal tool than `width`/`height`. Most effects need only `inset(top right bottom left)`: `inset(0)` shows everything, `inset(100%)` hides everything, `inset(0 50% 0 0)` hides the right half. Built on that: image reveals, comparison sliders, text masks, seamless tab highlights (duplicate the active styling and clip it to the active tab), hold-to-confirm fills, theme-switch wipes (prefer the View Transitions API for full-page wipes). `inset(0 round 16px)` replaces an animated `border-radius`.

### 3D

`perspective` and `transform-style: preserve-3d` on the parent, `rotateX/Y` + `translateZ` on children, `backface-visibility: hidden` for flip cards and coins. `translateZ` is invisible without `perspective`; without `preserve-3d` children flatten and can never pass behind a sibling.

### SVG

- `viewBox` is the camera; keep animation values in viewBox units. Close paths with `Z`. Zero-size shapes don't render at all.
- **Line drawing:** `stroke-dasharray` = one dash the length of the path plus a gap; `stroke-dashoffset` from the path length to 0 draws it. `pathLength="100"` lets you work in percentages. Needs `animation-fill-mode: forwards`. With `stroke-linecap: round` make the gap slightly longer than the dash or the cap peeks through.
- **Origins:** SVG `transform-origin` defaults to the viewBox origin, and `center` means the viewBox center. Use `transform-box: fill-box` to make origins relative to the element itself. **Motion overrides a `transformOrigin` set in `style`** on SVG elements — set it in `initial`.
- Stack transforms by wrapping parts in nested `<g>` elements; set `overflow: visible` on the `<svg>` so anything that overshoots isn't cut off. Morph between paths only when they have matching point structures.

---

## Motion for React (`motion/react`, formerly Framer Motion)

> React-specific. On any other stack, use the matching rows of the Translation table in `brain/chore/motion-stack.md` (`stack-adaptation.md` writes it); the reasoning and the values below still hold, only the API changes.

### Reach for it only when CSS can't

Real springs with momentum; layout changes (including `flex-direction`, `justify-content`); shared-element morphs; animating components out after they unmount; drag with momentum. Everything else CSS does in reasonable time. If the project already ships Motion, using it for readability is fine; if it doesn't, adding it is a decision to surface, not to make.

### Basics and transitions

`initial` → `animate` → `exit`, interpolated outside the render cycle (an animating component doesn't re-render). With no `transition`, physical values (`x`, `scale`) get a spring and others (`opacity`, `color`) a tween. Pull repeated configs into constants; `<MotionConfig transition={…}>` gives a subtree one timing family.

### AnimatePresence

- **A `key` on the animating child is mandatory** — without it nothing unmounts and the exit never fires. First thing to check when an exit does nothing. `AnimatePresence` wraps the conditional, it doesn't sit inside it.
- `mode="wait"`: old fully leaves before new enters (icon swaps, rich state changes). `mode="popLayout"`: both animate at once while siblings reflow (state swaps inside a button, step transitions, crossfades). If an exit looks broken, try the other mode next.
- `initial={false}` skips the mount animation for state swaps.
- **Exiting elements have stale props.** Pass `custom` to *both* `AnimatePresence` and the motion element — required for direction-aware slides. Variants in function form receive it: `initial: (dir) => ({ x: \`${110 * dir}%\`, opacity: 0 })`. Set direction in state together with the step.

### Layout animations

- `layout` animates any layout change; you change the element's real styles (class or style), not `animate`. Give `layout` to neighbours too, or they jump while the animated one glides.
- `layoutId` morphs one element into another across mount/unmount (tab indicators, card → detail). You can't steer a shared-layout animation directly — animate the parent and let children ride along.
- **Animated `borderRadius` must be an inline pixel value** (`style={{ borderRadius: 12 }}`). Layout animations scale, which distorts corners; Motion corrects it only for pixel radii, not class or `rem` values.

### Animating height

Motion can't animate `auto` → `auto`. Measure the content (`react-use-measure` or a small `ResizeObserver` hook) and animate to the number:

- The measuring `ref` and the `animate={{ height }}` go on **different** elements (outer animates, inner is measured); padding lives on the inner one.
- First render measures `0`: use `height: bounds.height || null` so it falls back to `auto` without a layout shift.

### Motion values

They update outside the render cycle — use them for anything per-frame, pointer tracking above all.

| Hook | Use it for |
| --- | --- |
| `useMotionValue` | Tracking an input 1:1 (drag position, drag-to-dismiss scale) |
| `useSpring` | Most pointer-driven motion — a raw value feels lifeless, a spring feels alive |
| `useTransform` | Map one value's range onto another (`useTransform(y, [0, 300], [1, 0])`), or format it (function form) |
| `useMotionTemplate` | Compose a live string (`clipPath`, `filter`) from motion values — interpolating them into an ordinary template string freezes the value |

Imperative `useAnimate` is powerful and hard to maintain; stay declarative unless orchestrating many elements across events.

### Debugging table

| Symptom | Cause |
| --- | --- |
| Exit never plays | Missing `key`; then wrong `mode` |
| Direction-aware slide always goes one way | Stale props — `custom` on both sides |
| Corners warp during a morph | Radius from a class/`rem` — use inline px |
| Height freezes or jumps | `ref` and `animate={{ height }}` on the same element, or no `null` fallback on first render |
| Neighbours jump during a layout animation | They need `layout` too |
| Animated string never updates | Use `useMotionTemplate` |
| Spring jittery or wild | Raise `damping` |
| Animates on first paint when it shouldn't | `initial={false}` on `AnimatePresence` |
| Drag stops dead / keeps sliding unexpectedly | `dragMomentum` — default on |
