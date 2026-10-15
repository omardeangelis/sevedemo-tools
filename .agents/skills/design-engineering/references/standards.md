# Motion Standards

The value catalog. Every number a prescription, review, audit, or prototype variant needs lives here — copy it, never approximate it from memory. Project tokens and documented project decisions win where they exist (see SKILL.md → Precedence).

---

## 1. The gate — should this animate at all?

Answer this before any easing or duration question. **"No animation" is a first-class outcome**, not a failure to deliver.

| How often one user meets it | Decision |
| --- | --- |
| 100+ times a day — keyboard shortcuts, command-palette toggle, arrow-key list navigation | No animation, ever |
| Tens of times a day — row hover, list/sidebar navigation | Remove it, or make it instant |
| Occasionally — modals, drawers, toasts, confirmations | Standard animation |
| Rarely / first time — onboarding, success moments, celebrations | A delight budget exists here, and only here |

- **Keyboard-initiated actions never animate.** They repeat constantly; any duration turns into perceived lag between the keypress and the result.
- **Selection highlights that follow the cursor or arrow keys are instant.** A soft fade looks nicer in a demo and trails one step behind in real use.
- **No stagger on dropdown or menu items.** Charming once, slower on every use after.
- **Every animation names its purpose in one sentence**: feedback, spatial consistency, state indication, explanation, preventing a jarring change, or (rare surfaces only) delight. "It looks good" on a frequent surface is a rejection.
- **Pacing:** the more things move, the less each movement means. Spend motion where it carries information.
- **Product vs marketing:** marketing pages get visited occasionally and are mostly read rather than operated, so slower timings, a one-time intro, or a hidden surprise are acceptable there. Product UI must feel fast.

---

## 2. Easing

Easing decides more of the feel than any other parameter. Pick the family first:

| The element is… | Family |
| --- | --- |
| Entering or leaving the screen | ease-out |
| Moving or morphing while staying on screen | ease-in-out |
| Changing color, background, or opacity on hover | `ease` |
| In constant motion — marquee, spinner, timer, hold-to-confirm progress, steady rotation | `linear` |
| None of the above | ease-out |

- **Never ease-in on UI.** Its slow start delays the exact frame the user is watching, then it slams into the stop — the reverse of how real objects settle.
- **The named keywords are categories, not values.** Browser built-ins (`ease-out`, `ease-in-out`) accelerate too weakly, so motion reads flat. Choose a real `cubic-bezier` from the family. When an animation feels flat, the curve is usually too weak — not the duration too long.
- **Prefer asymmetric curves** — steep start, long gentle settle. They feel alive and imitate a spring without one.
- **A symmetric ease-in-out right after a tap reads as lag** — the slow start sits between the tap and the response. Use an asymmetric curve for anything the user directly triggered.
- **Pair enter and exit**: same axis, same curve family, so the interaction reads as one space.

Curve set (use the project's tokens when they exist; otherwise these):

```css
:root {
  --ease-out-quint:     cubic-bezier(0.23, 1, 0.32, 1);        /* default UI enter/exit */
  --ease-out-expo:      cubic-bezier(0.19, 1, 0.22, 1);        /* reveals, card hover, strongest settle */
  --ease-out-quad:      cubic-bezier(0.25, 0.46, 0.45, 0.94);  /* press feedback */
  --ease-in-out-cubic:  cubic-bezier(0.645, 0.045, 0.355, 1);  /* on-screen moves (default) */
  --ease-in-out-quart:  cubic-bezier(0.77, 0, 0.175, 1);       /* on-screen moves, stronger */
  --ease-in-out-circ:   cubic-bezier(0.785, 0.135, 0.15, 0.86);/* dramatic on-screen moves */
  --ease-sheet:         cubic-bezier(0.32, 0.72, 0, 1);        /* edge-attached sheets (iOS feel) */
  --ease-drawer-height: cubic-bezier(0.25, 1, 0.5, 1);         /* snappy height changes */
  --ease-floating:      cubic-bezier(0.165, 0.84, 0.44, 1);    /* small floating drawers/panels */
}
```

---

## 3. Duration

| Element | Duration |
| --- | --- |
| Press feedback | ~150ms (100–160ms) |
| Hover (color, small lift) | 100–150ms — 300ms feels swimmy |
| Tooltip, small popover | 125–200ms |
| Dropdown, select | 150–250ms — 180ms reads faster than 400ms |
| Modal, drawer | 200–500ms |
| Small floating drawer/panel (not touching a screen edge) | ~200–270ms |
| Full-width, edge-attached sheet with `--ease-sheet` | ~500ms |
| Wide menu/viewport resize | ~250ms |
| Large element travelling across the screen | up to ~1s |
| Marketing / explanatory | Freer — judged per piece |

**Rule: product UI stays under ~300ms unless one of three things justifies more — the element's size, the distance it travels, or a very steep curve.** When a value goes past 300ms, write the justification next to it.

- **Curve first, then duration.** The two are one decision: a steep curve covers most of the distance in the first frames, so it can afford a longer duration (a 500ms sheet on `--ease-sheet` doesn't feel slow); a weak curve must be short.
- **Bigger and farther is slower.** A full-screen menu justifies more time than a tooltip.
- **Exits are shorter and simpler than entrances** — roughly 20% faster; by the time something closes, the user has moved on.
- **Overly fast motion is a defect too** — below the trackability threshold the eye can't follow the change and it reads as a glitch.
- **Perceived speed beats real speed:** a faster spinner makes identical load times feel shorter.
- **Adaptive duration** for transitions whose size varies (auto-height containers): scale the duration with how much changed so small changes don't over-animate.

  ```js
  // seconds; delta in px between the previous and next measured size
  const duration = Math.min(Math.max(Math.abs(delta) / 500, 0.15), 0.27)
  ```

---

## 4. Physicality and origin

- **No entrance grows from nothing.** Begin at `scale(0.9–0.97)` combined with `opacity: 0`. The bigger the floating element, the closer to 1 it starts (a large menu or panel: `scale(0.98)`).
- **Press feedback:** `transform: scale(0.97)` on `:active`, ~150ms with `--ease-out-quad`. It should be felt, not seen — `scale(0.9)` visibly collapses. Pressables want **both** a hover and a press response; hover without press feels like the click was lost.
- **Hover scale stays at 1–2%** (`scale(1.02)`). 5% inflates the element. Only very small elements justify more.
- **Hover lifts move a child, never the hovered element.** Moving the target out from under the pointer ends the hover, it drops back, the hover restarts — an endless flicker. Put the `translateY` on an inner element.
- **Trigger-anchored elements scale from their trigger.** Popovers, dropdowns, tooltips, menus: `transform-origin` at the anchor side. Use the primitive library's variable when there is one (Radix: `var(--radix-<component>-content-transform-origin)`; Base UI: `var(--transform-origin)`), else the side keyword (`top center` for a trigger above). **Modals are exempt** — they appear centered and keep `center`.
- **Translate in percentages** for anything whose size can vary: `translateY(100%)` always moves by the element's own height. Prefer it even when sizes are fixed — fewer magic numbers.
- **Pure rotation** reads best with ease-in-out; continuous rotation is `linear`.
- **Transform order matters** — rotate-then-translate lands somewhere else than translate-then-rotate.
- **Inline elements can't transform** — give a `<span>` `display: inline-block` first.

---

## 5. Springs

Springs have no fixed duration; they settle according to physics, which is why they feel organic and why they keep velocity when redirected.

```js
{ type: "spring", duration: 0.3, bounce: 0 }   // default: state swaps, UI transitions
{ type: "spring", duration: 0.5, bounce: 0.2 } // lively — only with a stated reason
{ type: "spring", stiffness: 120, damping: 14, mass: 0.8 } // physics form, when finer control is needed
```

- **Bounce defaults to 0.** Overshoot is personality: zero reads serious, more reads playful. Add it deliberately.
- **Bounce is earned by force.** A slight bounce at the end of a drag is physical (the user threw something); the same element closed by a button press gets none.
- **Bounce scales inversely with size** — small elements need more bounce for it to read at all.
- **A spring that looks wrong (jittery, odd overshoot) usually needs more `damping`.**
- **Low `mass` (~0.1) tracks an input tightly** — the right setting for a cursor follower.
- Use springs for: drag release with momentum, "alive" morphing elements, interruptible gestures, pointer-following decoration. Don't use them for plain color/opacity changes.
- CSS can only approximate a spring (`linear()`); a real one needs JS. That is a bundle-size trade-off — make it explicitly.

---

## 6. Interruptibility

- **CSS transitions and springs retarget from the current value; `@keyframes` restart from frame zero.** Anything that can be re-triggered while still moving — toasts stacking, toggles, accordions, drawers, anything a gesture can touch — uses transitions or springs. A keyframe there makes elements jump.
- **Keyframes are for:** infinite loops, autonomous one-shot sequences (page intro), a few discrete steps (blink, pulse), and simple enter/exit that can never be interrupted.
- **Enter without JS:** `@starting-style` declares the "before" state of an entering element.

  ```css
  .toast {
    opacity: 1;
    transform: translateY(0);
    transition: opacity 200ms var(--ease-out-quint), transform 200ms var(--ease-out-quint);
    @starting-style { opacity: 0; transform: translateY(100%); }
  }
  ```

  Fallback where unsupported: a mounted flag (attribute set after first paint) driving the target state. Primitive libraries expose enter/exit hooks as attributes (`data-state="open|closed"`, `data-starting-style` / `data-ending-style`) and keep the element mounted while the exit plays.

---

## 7. Asymmetric timing

Give the user's deliberate phase time, and make the system's answer quick. A hold-to-confirm visualizes time passing, so it runs `linear` over ~1.5–2s; releasing early snaps back in ~200ms with ease-out. Declare the two transitions on different states:

```css
.hold-fill                 { transition: clip-path 200ms var(--ease-out-quint); } /* release: snap back */
.hold-button:active .hold-fill { transition: clip-path 1.5s linear; }             /* hold: honest progress */
```

Using the same timing for both the hold and the release is a defect.

---

## 8. Stagger, hierarchy, orchestration

- **30–80ms between items** for product UI (marketing scroll reveals: 80–120ms, see `scroll.md`). Longer reads slow.
- **Vary delay and distance by importance.** The most important element leads and travels farthest; the least important can just fade. A uniform stagger (same delay, distance, easing per item) flattens hierarchy the way `linear` flattens easing.
- **Stagger is decoration** — it never blocks interaction.
- **One entrance per container.** Slide the panel in with its content already in place; don't also trickle the children in.
- **Ambient "life"** (idle float, slow rotation): barely perceptible, with deliberately non-matching durations (e.g. 3s and 4s) so layers never sync up, and an initial delay so users find the interactions first.

---

## 9. Cohesion and spatial consistency

- **One timing family per component.** Open, height change, and content crossfade share durations and curve so the component reads as a single object — one slow sub-animation breaks the whole thing.
- **Exit the way you entered.** Something that slid in from the left leaves to the left; fading it out contradicts the user's model of where it lives.
- **Forward and back have directions.** Going forward moves content toward the left (new content arrives from the right); going back reverses it. Both buttons animating the same way is a defect.
- **Expand from the source.** A detail view opened from a card grows from that card (object permanence); a full-screen crossfade loses the thing the eye was tracking.
- **Small containers crossfade instead of sliding.** For small, structurally similar content swaps, use opacity + an ~8px directional shift + light blur rather than a full `translateX(100%)`.
- **Mask a stubborn crossfade with blur.** When two overlapping states still read as two objects, add `filter: blur(2px)` during the transition. Keep animated blur ≤ ~20px (2–5px is plenty).
- **Match the personality.** A tool used all day is crisp and fast; an elegant consumer surface may use `ease` and slightly longer timings. A deviation from these standards is fine when it is deliberate and written down.

---

## 10. Numbers and text

- Changing digits (timers, counters, prices) use `font-variant-numeric: tabular-nums` so widths don't jitter.
- Text swap recipe: the outgoing text exits upward/downward while the new one enters from the opposite side — `opacity 0 → 1` with a ~25px `y` offset, spring `{ duration: 0.3, bounce: 0 }`, outgoing and incoming overlapping (no wait).

---

## 11. Feel-checks

Code can't prove feel. When feel matters, prescribe the check instead of guessing:

- **Slow it down** — DevTools Animations panel at 10–25%, or record and scrub frame by frame. Wrong origins, late fades, and out-of-sync properties are obvious at quarter speed.
- **Then full speed** — a motion approved only in slow motion isn't approved.
- **Real device** for gestures and opacity-heavy transitions (dev server over the local IP); a 120Hz screen shows roughness a 60Hz monitor hides.
- **Side by side with a reference** — record the product whose version feels right and scrub both.
- **Fresh eyes** — look again the next day before calling it done.

---

## Exempt — don't flag these

- `transform-origin: center` on a modal.
- `linear` on a marquee, spinner, timer, hold-to-confirm, or steady rotation.
- Long durations and one-shot intros on marketing pages.
- Bounce that a project note documents as brand personality.
- `@keyframes` on something that genuinely cannot be re-triggered mid-flight.
- Any motion trade-off the codebase or `brain/` documents as deliberate.
