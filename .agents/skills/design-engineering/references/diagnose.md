# Diagnosing Motion That Feels Wrong

Translate a vague "something's off" into a specific cause, then apply the smallest change that removes it. **Don't tweak numbers at random** — guessing at durations yields a different animation rather than a better one, and you lose track of which change mattered.

## The loop

1. **Reproduce on the setup where it feels wrong.** A drag that's smooth on a laptop may stutter on a phone; a fade that looks fine at 120Hz may look rough at 60Hz. Check on the real device (dev server over the local IP) before drawing conclusions.
2. **Slow it down.** At full speed most flaws are invisible. Record the motion and step through it, or play it at 10–25% in the DevTools Animations panel — a late fade, a wrong pivot point, or two states that read as separate objects become obvious. This step pays off more than any other.
3. **Match the symptom** to the tables below and test the causes in the order given (most likely first).
4. **Change a single variable, record again, compare.** Settle the curve before the duration — the right duration depends on the curve.
5. **Confirm at normal speed, then again later.** Approval in slow motion alone doesn't count; a second look on another day catches what tired eyes miss.

## Symptom → cause

### Sluggish, slow

| Look for, in order | Change |
| --- | --- |
| An ease-in curve | A strong ease-out family curve — the same duration will immediately feel quicker |
| A browser keyword curve | A custom curve from `standards.md` §2; keywords accelerate too gently at any duration |
| Product UI running past ~300ms | Shorten it — only size, distance, or a very steep curve justifies more |
| Motion on something used constantly | Remove it; at 100+ uses a day every millisecond reads as delay |
| A delay before an interactive response | Remove or shorten it; it reads as hesitation |

### Mechanical, lifeless

| Look for, in order | Change |
| --- | --- |
| `linear` on motion that isn't constant | ease-out family for entering/leaving, ease-in-out for moving; `linear` only for constant motion |
| A curve that's too gentle | A steeper one — flatness usually comes from the curve, not the duration |
| A fixed-duration ease where something should feel alive (drag release, morphing element) | A spring; if the spring then misbehaves, increase `damping` |
| Every item staggered identically | Weight delay and distance by importance |

### Feels cheap, can't pin it down

| Look for, in order | Change |
| --- | --- |
| Growing from `scale(0)`, or a fade with no movement at all | `scale(0.9–0.95)` plus opacity |
| The pivot point is wrong | Grow from the trigger (the primitive's origin variable); slow playback makes it obvious |
| Two states visibly overlap during a crossfade | About 2px of `filter: blur()` while it transitions |
| Parts of one component on different timings | Put them on one timing family |
| Exit doesn't match entrance | Leave along the entry direction, roughly 20% quicker and simpler |
| Motion clashes with the product's character | Crisp for tools, softer for polished consumer surfaces — a conscious exception is fine |

### Janky, dropping frames

| Look for, in order | Change |
| --- | --- |
| Layout properties being animated | `transform` / `opacity` |
| Framework state set on every frame | Motion values or direct style writes |
| A parent CSS variable moving the children | Set `transform` on the moving element |
| Motion shorthands running while the page works hard | The full `transform` string, or CSS/WAAPI |
| Blur above ~20px | Reduce it |

More in `performance.md`.

### Jumps, snaps, shifts

| Look for, in order | Change |
| --- | --- |
| Jumps when triggered again quickly (another toast, a quick toggle) | Keyframes start over — use transitions or springs |
| The exit never runs | `AnimatePresence` child has no `key`, or the wrapper is inside the conditional |
| Height snaps instead of animating | `auto` can't be animated — measure and animate the number (`implementation.md`) |
| A 1px shift at the start or end | `will-change: transform` (CPU/GPU hand-off) |
| The end state flashes before the animation | The starting state is applied too late — define it in CSS or with `@starting-style` |

### Triggers when it shouldn't, flickers

| Look for, in order | Change |
| --- | --- |
| Hover toggles on and off | The hovered element moves away from the pointer — animate an inner child instead |
| Hover effects on phones | Restrict to `(hover: hover) and (pointer: fine)` |
| Each tooltip animates as the pointer passes along a toolbar | After the first one opens, the rest appear instantly (`data-instant` → `transition-duration: 0ms`) |
| Plays again on every scroll into view or back navigation | Reveals are one-time — stop observing, or remember that it played |

## No matching row

The motion may match its spec and still feel wrong because the spec is wrong. Go back to basics in order: should it move at all (frequency)? → right curve family? → duration right for that curve and that element's size? If some product does this well, record it and compare the two frame by frame — copying what demonstrably works beats reasoning in the abstract. A crossfade that won't come right after all of that gets the 2px blur.

## Output

Report the symptom, the cause with its `file:line`, the one change to try first with exact values, and the feel-check that will confirm it. With several plausible causes, rank them and say why the first one goes first.
