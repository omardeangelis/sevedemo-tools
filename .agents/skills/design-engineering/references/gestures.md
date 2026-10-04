# Gestures

Drag, swipe, fling, hold, sheets. A gesture is direct manipulation: while the pointer is down the element *is* the finger; once it lifts, physics finishes the job. Almost every gesture that feels wrong mixes those two phases up.

## Before building: does a solution already exist?

A solid drawer involves momentum, an overlay that dims in step with the drag, dismissal that respects flick speed, focus containment, and closing on Escape — weeks of edge cases. Check what the project already ships first (see `library-pick.md`): for a bottom sheet in React, a dedicated drawer primitive (Vaul) is the default; other stacks take the drawer row of `brain/chore/motion-stack.md`. Hand-roll only interactions no library covers (custom swipe cards, bespoke drags), and never add a dependency on your own authority — surface it.

## Phase 1 — Track (pointer down)

- **The element follows the pointer exactly.** Nothing smooths it — not a curve, a duration, or a spring. Drive it with a raw motion value (`useMotionValue`) or direct `transform` writes. A spring here makes the element trail the finger, like dragging through syrup.
- **Write `transform` on the dragged element itself.** Never move children through a CSS variable set on a parent — variables inherit, so every move recalculates style for every descendant (a known cause of drag lag past ~20 list items).
- **No framework state per pointer move.** Re-rendering on each `pointermove` costs frames; write through motion values or the element's style instead.
- **Rubber-band past the edges.** Beyond a boundary the element moves a fraction of the pointer distance instead of stopping dead (Motion: `dragElastic` ≈ 0.2). Resistance says "nothing further" physically; a hard stop feels like hitting a wall.
- **Capture the pointer once dragging starts** (`setPointerCapture`) so the drag survives the pointer leaving the element, and **ignore extra touch points** mid-drag.

## Phase 2 — Release (pointer up)

- **Finish with a spring seeded with the release velocity.** The element carries on at the speed the finger gave it. With a fixed-duration curve every throw ends the same way, which reads as artificial. Never a keyframe.
- **Dismiss on distance OR velocity.** Crossing ~40–50% of the travel dismisses; so does a fast flick over a short distance. Distance-only thresholds make flicks feel ignored.
  - Hand-rolled: `velocity = |distance| / elapsedMs`; above ~0.11 px/ms dismiss regardless of distance.
  - Motion: read `info.offset` and `info.velocity` (px/s) in `onDragEnd`; ~500 px/s is a reasonable flick threshold. Tune both on a real device.
- **Snap-back is fast.** If the gesture falls short, the spring returns it promptly — a lazy return feels like the interface disagreeing with the user.
- **Bounce only at the end of a drag** (force was applied), kept small, larger for smaller elements. The same element closed by a button gets zero bounce.
- **`dragMomentum`** is on by default in Motion: it suits a card being thrown away, not an element being placed — turn it off when the element should stop where the finger stops.

## Interruptibility

The user must be able to catch a closing sheet and drag it back. Springs and CSS transitions retarget with their current velocity; `@keyframes` restart from zero and cannot be caught. **Nothing a gesture can touch uses a keyframe animation.**

## Linked values

Whatever moves with the gesture — the overlay fading, the page behind scaling — is derived from the same source, not animated separately:

```jsx
const dragY = useMotionValue(0)
const backdrop = useTransform(dragY, [0, panelHeight], [0.6, 0])
```

One source of truth keeps them in sync mid-gesture and when the user reverses. Two independent animations drift apart the moment the gesture is interrupted.

## Sheets without a spring library

In plain CSS, a sheet attached to a screen edge gets close to the iOS feel with `--ease-sheet` (`cubic-bezier(0.32, 0.72, 0, 1)`) at roughly half a second — the abrupt start keeps it responsive and the long tail mimics a spring coming to rest.

- A **small floating drawer** (not touching a screen edge) overrides that to ~200ms, e.g. `transform 200ms cubic-bezier(0.165, 0.84, 0.44, 1)` with the overlay on the same timing. The 500ms timing only reads right on a full-width sheet.
- **One timing family**: the drawer's height changes and content crossfades use the same duration and curve as its open/close.
- Interactive children inside a draggable surface must opt out of starting a drag (Vaul: `data-vaul-no-drag`), or pressing a button inside drags the sheet.

## Direction

**An element dismisses along the axis it entered on.** A toast that rises from the bottom is swiped down to dismiss; a gesture on an axis the element never moved along has to be learned instead of felt.

## Hold gestures

Hold-to-confirm visualizes time, and time is linear: `linear` over ~1.5–2s during the hold, fast ease-out snap-back (~200ms) on early release. Symmetric timing is a bug. See `standards.md` §7 for the CSS.

## Touch checklist

- **Try it on an actual phone** through the dev server's LAN address — emulated touch on a trackpad is misleading, and a 60Hz display hides choppiness a 120Hz phone reveals.
- **Touch targets of at least 44×44px**; extend small controls with an invisible `::before` area instead of enlarging the layout.
- **`touch-action`** declares which panning the browser keeps: for a vertical drag, `touch-action: pan-x` (or `none` when the element owns both axes) so native scrolling doesn't fight the gesture.
- **Hover styles only for precise pointers** (`@media (hover: hover) and (pointer: fine)`) — taps otherwise trigger stray hover states.

## Reduced motion

Following the finger stays — that movement is the user's own. Removed: inertia after release, bounce, and any ornamental motion around the gesture. When `prefers-reduced-motion: reduce` is set, finish the release with a brief fade or a direct jump to the end position rather than a sprung throw.

## Still wrong?

A strange spring → raise `damping`. A stuttering gesture → re-check the track-phase rules, then `performance.md`. A feeling you can't name → `diagnose.md` (record the gesture, scrub it frame by frame).
