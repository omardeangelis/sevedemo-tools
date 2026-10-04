---
name: design-engineering
description: Motion and interaction-craft standards for UI work — whether something should animate at all, exact easing curves, durations, springs, origins, gestures, scroll effects, reduced motion, and animation performance — plus the review, audit, opportunities, diagnosis, and motion-brief procedures the `design-engineer` agent and the `prototype` skill run on. Code examples are React; other stacks (Vue, Svelte, Angular, Solid, native) translate through a researched stack profile. Use when writing, reviewing, or fixing animation or transition code; building drag, swipe, or sheet gestures or scroll reveals; choosing between CSS, WAAPI, and an animation library; handling prefers-reduced-motion; or when motion feels janky, sluggish, or off. Triggers on — animation, transition, easing, cubic-bezier, duration, spring, keyframes, @starting-style, transform-origin, press effect, drawer, popover, toast, gesture, drag, swipe, scroll reveal, parallax, motion/react, AnimatePresence, layoutId, prefers-reduced-motion, jank.
---

# Design Engineering

The motion-craft bar for this project: when to animate, exactly how, and how to judge, audit, and diagnose what was built. This file is the decision layer and the router; the exact values and procedures live in `references/` — load the one the task needs rather than approximating from memory.

## Contract

- **Role:** motion and interaction-craft knowledge base — decision rules, exact values, and the procedures that apply them
- **Entrypoint type:** model-invocable reference — loads whenever motion work is in play; no workflow of its own beyond the routing below
- **Upstream:** any task that writes, reviews, plans, or explores motion — an `implement-spec` task carrying motion targets, `create-plan`'s motion budget, a `prototype` run, a direct request
- **Consumers:** the **`design-engineer`** agent routes every mode to these references; **`prototype`** holds each variant to `standards.md`, sets the feel with `motion-brief.md`, and runs the feel-checks; the motion-craft verifier pass in **`adversarial-review`** uses `review.md` as its rubric
- **Delegates to:** nothing. For advisory work — a motion budget, an audit, a craft opinion on a diff — prefer briefing the `design-engineer` agent, which reads this skill in a clean context
- **Writes:** nothing, except the stack profile `brain/chore/motion-stack.md` (`references/stack-adaptation.md`) and audit plans under `brain/chore/animation-plans/` (`references/audit.md`)

## Precedence

Project specifics win where they exist; this skill fills everything they leave open.

1. The root `AGENTS.md` conventions and the project's real tokens (easing/duration variables, the component library's enter/exit hooks) — extend them, never build a parallel motion system.
2. Brand/identity guidance wins on color and typography; a project frontend-design skill wins on layout and aesthetic direction.
3. Documented project motion decisions — personality, deliberate deviations, chosen values — in `brain/chore/` (a `brain/chore/motion.md` note is the natural home) or in code comments, and the stack profile `brain/chore/motion-stack.md` for how each API is spelled in this stack.
4. This skill's references.

In a brain project this skill — with the `design-engineer` agent linked to it — is managed by `brain upgrade`: editing it in place turns every upgrade into a conflict. Record project deviations in tokens or `brain/chore/` instead, and they will win by rule 3.

## Stack

The references write framework-specific code for React with Motion for React; the gate, the values, CSS, WAAPI, and every procedure are framework-neutral. Before giving or writing framework-specific code, read the project's stack profile, `brain/chore/motion-stack.md`, and route every React API through its Translation table — the curve, duration, and spring feel never change with the stack, only the API that carries them.

- **No profile, or it no longer matches the project's manifests** → run `references/stack-adaptation.md` first: detect the stack (asking the user when detection is empty or ambiguous) and, for anything other than React on the web, research the stack's equivalents from primary sources.
- **Running as a subagent that can't ask or research** → don't adapt; say the profile is missing and keep the advice framework-neutral (CSS, WAAPI, vanilla `motion`).

## The rules that always apply

1. **Gate first.** Frequency and purpose decide whether anything animates. Keyboard-initiated and 100+/day actions never animate; cursor-following highlights are instant; "no animation" is a valid answer.
2. **Easing by family, as a real curve.** Things arriving or leaving decelerate (ease-out family); things repositioning on screen accelerate then decelerate (ease-in-out); color-only hover changes use `ease`; only perpetual motion is `linear`. ease-in has no place in UI. Treat keywords as families and choose an actual `cubic-bezier`.
3. **Duration under ~300ms for product UI** unless size, distance, or a steep curve justifies more — and say which. Curve first, then duration. Exits shorter than entrances.
4. **Nothing appears from nothing.** Enter from `scale(0.9–0.97)` + opacity; trigger-anchored elements grow from their trigger; modals stay centered.
5. **Interruptible where re-triggerable.** Transitions and springs, not `@keyframes`, for anything that can fire again mid-flight or be touched by a gesture.
6. **Composite-only.** Animate `transform` and `opacity`; anything else needs a reason.
7. **Two variants.** Every movement ships a reduced-motion variant that keeps the meaning (opacity, color) and drops the travel; decorative motion turns off.
8. **One entity.** A component's sub-animations share one timing family; exits mirror entries.
9. **Exact values or nothing.** Never "a nicer easing" — `cubic-bezier(0.23, 1, 0.32, 1)` at `200ms`.
10. **Feel is checked, not assumed.** Slow motion, full speed, real device, fresh eyes.

## Routing

| The task | Load |
| --- | --- |
| Deciding whether/how something animates; any easing, duration, spring, origin, stagger, or cohesion value | `references/standards.md` |
| Drag, swipe, fling, sheets/drawers, hold-to-confirm | `references/gestures.md` |
| Reduced motion, autoplay, smooth scroll, hover gating, focus, tap targets | `references/accessibility.md` |
| Jank, dropped frames, which property to animate, CSS vs JS on performance grounds | `references/performance.md` |
| Scroll reveals, scroll-driven/scrubbed motion, parallax, sticky sections | `references/scroll.md` |
| Writing it: CSS transitions/keyframes, `@starting-style`, `clip-path`, 3D, SVG, Motion for React and its traps | `references/implementation.md` |
| Choosing the tool, primitive, or library | `references/library-pick.md` |
| Reviewing motion code in a diff or component | `references/review.md` |
| Codebase-wide motion audit and executable plans | `references/audit.md` |
| Finding where motion is missing (and what should stay static) | `references/opportunities.md` |
| "It feels off / janky / wrong" — diagnosis before any fix | `references/diagnose.md` |
| Specifying motion before it's built; interviewing about motion | `references/motion-brief.md` |
| Naming an effect from a loose description | `references/vocabulary.md` |
| The project isn't React on the web, or `brain/chore/motion-stack.md` is missing or stale | `references/stack-adaptation.md` |

Most tasks need `standards.md` plus one more. Load more than you think you need rather than guessing a value.

## Credits

Based on Emil Kowalski's *Animations on the Web* course ([animations.dev](https://animations.dev/)); rules restated and adapted to the brain workflow.
