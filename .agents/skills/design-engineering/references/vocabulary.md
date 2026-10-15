# Motion Vocabulary

Turn a loose description ("the bouncy thing when it opens", "it grows out of the button") into the precise term — useful for naming prototype directions, writing specs, and briefing other agents. Lead with the term; contrast close alternatives when two compete; if nothing fits, say it's an approximation rather than inventing a term.

## Easing and timing

- **Easing** — how the rate of change varies over time; the biggest single factor in feel.
- **ease-out** — fast start, gentle stop; responsive; the default for entering and leaving.
- **ease-in** — slow start, accelerating stop; feels sluggish; avoided on UI.
- **ease-in-out** — slow, fast, slow; for movement while staying on screen.
- **`ease`** — the CSS default; an asymmetric, gentle curve suited to hover color/opacity.
- **linear** — constant speed; only for constant motion (marquee, spinner, timer, hold progress).
- **Custom curve / `cubic-bezier`** — a curve defined by its control points; typically punchier than the named keywords.
- **Asymmetric curve** — front- or back-loaded; feels more alive than a symmetric one.
- **Trackability threshold** — below it, motion is too fast for the eye to follow.
- **Perceived performance** — how fast it *feels*, independent of real time.

## Springs and physics

- **Spring** — motion driven by mass, stiffness, and damping rather than a fixed duration.
- **Bounce / overshoot** — the spring passing its target before settling; personality, default zero.
- **Perceptual duration** — when a spring *feels* finished, even if it's still settling.
- **Interruptibility** — redirecting an in-flight animation while keeping its velocity (springs, CSS transitions — not keyframes).
- **Momentum** — motion continuing after release and decaying naturally.

## Entrances, exits, physicality

- **Pop-in / scale-in** — growing into place from ~0.95 with opacity; never from 0.
- **Press feedback** — a brief shrink (~0.97) on press; felt, not seen.
- **Lift** — a hover raise, applied to an inner element.
- **Hover flicker loop** — a hover transform moving the element out from under the pointer, repeatedly.
- **Origin-aware animation** — growing out of the trigger rather than the element's own center.
- **Stagger** — items animating one after another with small offsets.
- **Orchestration** — deliberately sequencing several elements into one wave.
- **Layered entry** (anti-pattern) — a container entrance plus child entrances.
- **Blur bridge** — a small blur during a crossfade so two states read as one change.

## Space and navigation

- **Spatial consistency** — the interface behaves like one coherent space: exits mirror entries, forward and back have directions.
- **Object permanence** — an element visibly travels between states instead of vanishing and reappearing.
- **Direction-aware animation** — enter/exit direction follows the direction of navigation.
- **Crossfade** — one state dissolves into the next in place, often with a small shift.
- **Morph** — one element changing shape or size while staying on screen.
- **Shared-element transition** — an element travelling and transforming from one place/size to another (thumbnail → detail).

## Layout (Motion for React — other stacks name these in the stack profile)

- **Layout animation** — animating between two layouts across renders, including properties CSS can't animate.
- **Shared layout animation (`layoutId`)** — linking two separate elements so one morphs into the other.
- **`AnimatePresence`** — keeps an element mounted long enough to play its exit.
- **`popLayout` / `wait` modes** — exit and enter together with siblings reflowing / exit fully before entering.
- **Variants** — named, reusable target sets; function variants read a `custom` value.
- **Motion value** — a value updated outside the render cycle for per-frame work.
- **Auto-height animation** — measuring content to animate a container's height.

## Scroll

- **Triggered reveal** — crossing a threshold starts a self-timed animation.
- **Scrubbed / scroll-driven** — scroll position is the animation's clock.
- **Parallax** — layers moving at different rates for depth.
- **Scrollytelling / sticky sequence** — a pinned section whose story advances with scroll.
- **Scroll-jacking** (anti-pattern) — taking over the user's scrolling.

## SVG

- **Line drawing** — revealing a stroke as if drawn, via `stroke-dasharray` / `stroke-dashoffset`.
- **Path morphing** — animating a path between two shapes with the same point structure.
- **`viewBox`** — the SVG camera; **`transform-box`** — what an SVG transform origin is relative to.

## Gestures and touch

- **Track / release phases** — 1:1 following while down; physics after lift.
- **Rubber-banding** — rising resistance past an edge, snapping back on release.
- **Drag-to-dismiss** — drag distance mapped directly to position/scale, dismissing past a threshold or on a flick.
- **Follow-the-cursor** — an element trailing the pointer through a spring.
- **Hold-to-confirm** — a press-and-hold that visualizes time before a destructive action.
- **Two-tap pattern** — on touch, first tap shows the hover state, second acts.

## Performance and accessibility

- **Composite-only properties** — `transform`, `opacity` (and increasingly `filter`, `clip-path`): cheapest to animate.
- **Layout / Paint / Composite** — the three rendering steps; cheap motion touches only the last.
- **Hardware acceleration** — animation running off the main thread.
- **Transform shift** — a 1px jump from a CPU↔GPU hand-off; fixed with `will-change`.
- **Reduced motion** — honoring `prefers-reduced-motion`: gentler, not zero.

## Craft

- **Cohesion / single entity** — every sub-animation of a component on one timing family.
- **Feel** — the personality conveyed by speed and easing, as fonts and color convey brand.
- **Micro-interaction** — a small response or loop confirming an action.
- **Taste** — the trained ability to tell good motion from bad and say why.
