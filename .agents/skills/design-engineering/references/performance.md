# Performance

However good the curve and timing, motion only feels right if every frame arrives on time; the same animation at half the frame rate feels broken. Performance isn't a final polish step — it's a precondition for the motion being perceived at all.

## The budget

- At 60fps each frame has **16.7ms**; at 120Hz — most current phones and many laptops — about **8.3ms**. Plan for the tighter number.
- One layout recalculation on a heavy page can take over 100ms, which costs many frames, not one.
- **Your own fast machine proves nothing.** Judge on a mid-range phone.

Two things decide the outcome: **which** properties you animate (the cost of each frame — entirely up to you) and **where** the animation runs (whether busy JavaScript can block it — partly up to the browser). Put your effort into the first.

## Which properties

A visual change goes through up to three rendering stages: **Layout** (computing sizes and positions), **Paint** (drawing pixels into layers), and **Composite** (assembling layers on screen). Where a property enters that pipeline sets its price:

| Cost | Properties | Notes |
| --- | --- | --- |
| Composite only | `transform` and `opacity` — and, in recent Chromium and Firefox, also `filter`, `clip-path`, `background-color` | Cheapest; the browser gives them their own layer |
| Paint + composite | `color`, `box-shadow`, `border-radius` | No re-layout, but a redraw on every frame |
| Layout + paint + composite | `width`, `height`, `padding`, `margin`, `top`, `left`, `border-width` | Most expensive; may push surrounding elements around |

**Animate `transform` and `opacity` unless there's a reason not to**, and test anything else across browsers and devices. Cheaper substitutes:

| Rather than animating | Animate |
| --- | --- |
| `width`, `height`, `padding` (growing/shrinking) | `scale()` |
| `margin`, `top`, `left` (moving) | `translate()` — percentages follow the element's own size |
| `display`, `visibility` | `opacity` |
| `box-shadow` | `filter: drop-shadow(…)` |
| `border-radius` | `clip-path: inset(0 round <radius>)` |

The last two catch people out — they don't look like layout properties, yet they force a repaint on every frame.

- An absolutely positioned element, or one with very few children, can sometimes animate layout properties without visible cost. Since a `scale()` version looks identical and can't get worse on slower hardware, pick that one anyway.
- Layout properties also shove neighbours: animating a sidebar's `margin-left` reflows the whole page beside it every frame, while `translateX` leaves it alone.
- `transition: all` quietly includes expensive properties — always name them.

## Where it runs

| What drives it | Thread |
| --- | --- |
| JavaScript with `requestAnimationFrame` (GSAP, Motion's React components) | Main thread, always |
| Web Animations API (including Motion's `animate()`) | Can run accelerated |
| CSS transitions and animations | Can run accelerated |

Accelerated means it runs away from the main thread and stays smooth however busy the page's JavaScript gets. That's dependable for `transform` and `opacity`, and improving for `filter`, `clip-path`, `background-color`, and SVG.

- **Be careful with motion that plays during heavy work** — route changes, tab switches while a page loads, animations alongside data fetching or hydration. Use CSS or WAAPI there. (A tab indicator built as a shared-layout animation stuttered during navigation and became smooth once rewritten in CSS.)
- **Motion's `x`, `y`, `scale` shorthands don't run accelerated** — under the hood they're CSS variables, and animated variables stay on the main thread. They're fine as a default for readability; for motion that must survive a busy page, animate the whole string, e.g. `animate={{ transform: "translateX(100px)" }}`.
- Acceleration is never guaranteed — browsers silently skip it in some cases (percentage translates have been one). Don't contort correct code chasing it; what you fully control is the property list.

## Traps that look harmless

- **Inherited CSS variables.** A variable set on a parent and read by children's transforms forces a style recalculation for every descendant whenever it changes — the more items, the slower each frame. Put the `transform` on the moving element itself.
- **Re-rendering every frame.** Updating framework state from every frame, scroll, or pointer event re-renders constantly. Write to `element.style.transform` or a motion value instead.
- **Blur.** Animated `filter: blur()` becomes costly quickly, Safari especially. Keep it at or below ~20px; a few pixels is enough to soften a crossfade.

## `will-change`

It promotes an element to the GPU ahead of time. That cures the one-pixel "jump" caused by an element moving between CPU and GPU rendering, and can help a genuinely expensive paint such as a large blurred element. **Use it only once you've actually seen that jump or dropped frames** — `transform`/`opacity` animations are promoted anyway, and every layer uses GPU memory. Apply it to the elements that animate, keep promoted layers small, and use `contain: layout style paint` to isolate the repaint of heavy filtered elements.

## So should JavaScript animation be avoided?

No. Its cost only shows when heavy work overlaps the animation — uncommon, and now easy to spot. JavaScript libraries provide what CSS can't: real springs, shared-layout morphs, exit animations for removed elements, momentum gestures. Sensible split: **CSS for simple motion and anything that must stay accelerated; a library for complex, dynamic, gesture-driven motion.**

## Finding the cause of dropped frames

Go through these in order — the earlier ones are the usual culprits:

1. **What's being animated?** Layout properties first, then paint-cost ones (`box-shadow`, `border-radius`), then any `transition: all`.
2. **Is the page busy at that moment** (navigation, fetching, hydration, a long task)? Move the motion to CSS or WAAPI.
3. **Does the framework re-render each frame?** Look for state updates in rAF loops, scroll handlers, or gesture handlers.
4. **Does it get worse with more content?** Inherited-variable recalculation, or simply too many animated nodes.
5. **Is a CSS variable animated anywhere** — directly, or through Motion's shorthands?
6. **Is there animated blur above ~20px**, particularly in Safari?
7. **Still a shift or stutter?** Only now add `will-change: transform` to the animated element.

Measure instead of eyeballing: DevTools' Performance panel for frame timing, the Animations panel to slow things down. Profile a real mid-range phone through remote debugging — CPU throttling on a desktop simulates a slower processor, not a weaker GPU or tighter memory.
