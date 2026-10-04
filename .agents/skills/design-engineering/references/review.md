# Review Rubric

The bar for judging motion code — used by the `design-engineer` agent's Review mode, by the motion-craft verifier pass in `adversarial-review`, and by anyone reviewing animation in a diff. It reviews motion only; general code goes to a general review.

## Posture

Motion that *runs* is not motion that *feels right*. A transition that technically works yet drags, pivots from the wrong point, plays more often than it should, or stutters counts as a regression. **Default to flagging; approval is earned.** Every value you propose comes from `standards.md` (or the project's tokens) — never approximated.

## The ten standards

A violation of any is a finding.

1. **Justified** — the animation has a stated purpose. "Looks cool" on a frequent surface blocks.
2. **Frequency-appropriate** — keyboard-initiated and 100+/day actions don't animate; tens/day are reduced or instant; cursor-following highlights are instant.
3. **Strong, correct easing** — decelerating curves for arrivals and departures, accelerate-decelerate for on-screen moves, `ease` for color-only hover, `linear` reserved for perpetual motion. ease-in on UI blocks. Built-in keywords on deliberate motion are too weak — expect a custom curve.
4. **Duration matched to curve and size** — product UI under ~300ms unless size, distance, or a steep curve justifies it; exits shorter than entrances; not so fast it can't be tracked.
5. **Origin and physicality** — trigger-anchored elements scale from the trigger (modals exempt); no `scale(0)`; press `scale(0.97)`; hover scale 1–2%; hover lifts on a child.
6. **Interruptible** — rapidly re-triggered or gesture-driven motion uses transitions or springs, not keyframes; 1:1 tracking uses a raw motion value, not a spring.
7. **Composite-only** — `transform`/`opacity`; no layout or paint-tier properties without a reason; full `transform` string for motion that runs while the page is busy; no parent CSS variable driving children.
8. **Accessible** — a reduced-motion variant that removes movement and keeps meaning; decorative motion off entirely under `reduce`; hover gated to fine pointers; tap targets ≥ 44px.
9. **Asymmetric where it should be** — deliberate phases (hold, destructive confirm) slow and honest, responses fast; exits shorter.
10. **Cohesive** — one timing family per component; exit matches entry; forward/back directions consistent; matches the product's personality.

## Flag on sight

- `transition: all`
- `scale(0)` entrances, or pure fades with no starting transform where one belongs
- ease-in on any UI interaction; a built-in keyword on a deliberate animation
- Any animation on a keyboard shortcut, command palette, arrow-key navigation, or 100+/day action
- Product UI duration > 300ms with no stated justification
- Default `transform-origin: center` on a popover, dropdown, menu, or tooltip
- `@keyframes` on toasts, toggles, drawers, or anything re-triggered rapidly
- Animated `width`/`height`/`margin`/`padding`/`top`/`left`; animated `box-shadow`/`border-radius` on large or many elements
- Motion `x`/`y`/`scale` shorthands on motion that plays during navigation, loading, or hydration
- A CSS variable on a parent updated per frame to move children
- Hover scale above 2% (`hover:scale-105`); `translateY` hover on the hovered element itself
- Movement with no `prefers-reduced-motion` handling; ungated `:hover` motion
- Symmetric timing on a press-and-release or hold
- A parent entrance plus staggered children; a uniform stagger; stagger on menu items
- Layout animation with a class/`rem` border radius; `AnimatePresence` child without `key`
- Animated blur above ~20px
- SVG transforms left on the viewBox origin; `transformOrigin` in `style` on a Motion SVG element
- Scroll reveals that replay on scroll-up, hide content without JS, or sit above the fold; any scroll-jacking

## Remedy order

Propose the earliest move that fixes it:

1. **Delete** the animation (no purpose, high frequency, keyboard-triggered).
2. **Reduce** it — shorter, smaller transform, fewer properties, fewer things moving at once.
3. **Fix the easing** — family and a strong custom curve.
4. **Fix origin and physicality** — origin variable, `scale(0.95)` + opacity, press/hover values.
5. **Let it be caught mid-flight** — swap keyframes for transitions or `@starting-style`; use a spring for gesture-driven motion.
6. **Move it to the compositor** — layout props → transforms; shorthand → transform string; CSS/WAAPI under load.
7. **Make timing asymmetric** — give the user's deliberate phase time, answer quickly, keep exits brief.
8. **Polish** — blur-masked crossfades, importance-weighted stagger, adaptive duration, spring where alive.
9. **Accessibility and cohesion** — reduced-motion variant, pointer gating, one timing family, personality fit.

## Output format

**Part 1 — findings table.** One row per issue, cited by `file:line`. Never a "Before:/After:" list.

| Location | Before | After | Why |
| --- | --- | --- | --- |
| `Dropdown.tsx:41` | `ease-in 300ms` | `180ms var(--ease-out-quint)` | ease-in delays the moment the user watches; built-ins are too weak |
| `Card.tsx:12` | `hover:scale-105` | `scale(1.02)` inside `(hover: hover) and (pointer: fine)` | 5% inflates; touch shouldn't trigger hover |
| `Popover.tsx:8` | `transform-origin: center` | `var(--radix-popover-content-transform-origin)` | Scales from its trigger (modals stay centered) |

**Part 2 — verdict by tier**, highest first, empty tiers omitted:

1. **Feel-breaking** — sluggish/weak easing, comes from nowhere, animates a high-frequency or keyboard action.
2. **Should be removed or reduced** — motion without purpose, double entrances, too much moving at once.
3. **Performance** — non-composite properties, shorthands under load, recalc storms, heavy filters.
4. **Interruptibility and timing** — keyframes where transitions/springs belong; symmetric timing.
5. **Origin, physicality, cohesion** — wrong origin or scale values, mismatched personality, broken spatial consistency.
6. **Accessibility** — reduced motion, pointer gating, tap targets.

Close with an explicit decision:

- **Block** — any feel-breaking finding; motion on keyboard-driven or constantly used actions; entrances from `scale(0)`; ease-in anywhere in UI; a non-composite animation with an easy composite fix; movement with no reduced-motion path.
- **Approve** — nothing from the Block list; timings and curves inside the budgets; re-triggerable motion can be interrupted; every movement has its reduced-motion version.

When feel can't be judged from the code (does the crossfade read as one object, does the bounce fit the brand), say so and prescribe the feel-check from `standards.md` §11 instead of inventing a verdict.
