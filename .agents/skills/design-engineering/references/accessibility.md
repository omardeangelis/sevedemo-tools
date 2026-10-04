# Accessibility

Motion helps most people understand an interface and makes some people physically sick (vestibular disorders) or pulls their attention off the task. Users set `prefers-reduced-motion` once at the OS level and expect every site to respect it without asking again.

## Gentler, not zero

The `reduce` setting is **not** a request to strip every animation — removing them wholesale makes state changes harder to follow, which is its own accessibility failure. The rule is **remove the motion, keep the meaning.**

| Under `prefers-reduced-motion: reduce` | Do |
| --- | --- |
| Movement — `transform`, translate, scale, position, layout, animated height | Remove. Nothing travels. |
| Meaning — `opacity`, `color`, `background-color` | Keep. The state change stays legible. |
| Autoplaying and looping animation | Stop it, or freeze it on a meaningful frame |
| Purely decorative motion — idle floats, ambient loops, parallax | Remove entirely. It carries no meaning, and lingering motion falsely implies interactivity. |
| Essential explanatory sequences | Jump between the key frames instead of tweening |

So a modal that scales in fades in; a sidebar that slides from `-100%` fades; a multi-step form that slides between steps crossfades.

## Workflow: two variants

1. Build the animation and get it feeling right.
2. Write the `reduce` variant by applying the table above to **every** property that moves.
3. Watch the `reduce` variant with the preference emulated (Chrome DevTools → Rendering → *Emulate CSS media feature prefers-reduced-motion*).

Done means: every animation you touched has both variants **and** you watched the reduced one. Reasoning about it isn't enough — a frequent miss is a reduced version that still travels because a leftover `transform` survived in a shared class, a spring config, a measured height, or a `layout` prop.

## Implementation

**CSS** — swap the animation rather than deleting it:

```css
.panel { animation: panel-in 220ms var(--ease-out-quint); }

@media (prefers-reduced-motion: reduce) {
  .panel { animation: fade-in 180ms ease; }
}
```

**Tailwind** — the `motion-safe:` / `motion-reduce:` variants map to the two media queries.

**Motion for React** (other stacks: the stack profile's reduced-motion row, `brain/chore/motion-stack.md`):

- `useReducedMotion()` returns `true` under `reduce`; branch values or, cleaner, swap the whole variant set (a movement set and an opacity-only set with the same state names).
- `<MotionConfig reducedMotion="user">` at the app root makes Motion animate only opacity and background color when the preference is set. **Its default is `"never"`**, so it does nothing until set — wrap the app once, then use per-component `useReducedMotion` where the fade-only default loses meaning.
- Movement hides in several places in one component: a transform, an animated height, and a `layout` prop each need their own switch (`animate={reduce ? {} : { height }}`, `layout={!reduce}`). Audit every animating property after the single `useReducedMotion()` call.

**No animation library?** A dependency-free hook is a few lines: start `false` (so server and client markup match), read `window.matchMedia("(prefers-reduced-motion: reduce)")` inside an effect, and subscribe to its `change` event. Because the first render is always `false`, use it to branch animation *values* only — never to gate mounting, or reduced-motion users get a flash of the animated variant.

## Recipes with a specific mechanism

- **Smooth scrolling is something to switch on, not off** — enable it only inside the `no-preference` query, so the calm behavior is what anyone gets by default:

  ```css
  @media (prefers-reduced-motion: no-preference) {
    :root { scroll-behavior: smooth; }
  }
  ```

- **Autoplaying images (GIF/animated AVIF):** wrap in `<picture>`; put the animated sources in `<source>` elements with `media="(prefers-reduced-motion: no-preference)"` and a static `<img>` as the fallback. No JS, and the animated file is never downloaded under `reduce`.
- **Autoplaying video:** autoplay only when `matchMedia("(prefers-reduced-motion: no-preference)")` matches; otherwise leave it paused with a visible play/pause control. Ship the custom control `hidden` until the script wires it, so a dead button never flashes on load.
- **Looping animation:** pause it on a frame you chose, not frame 0 (usually the least representative state). A negative `animation-delay` seeks into the timeline before pausing:

  ```css
  @media (prefers-reduced-motion: reduce) {
    .loop { animation-play-state: paused; animation-delay: -0.4s; } /* try values, keep the best frame */
  }
  ```

## Beyond reduced motion

- **Gate hover motion** behind `@media (hover: hover) and (pointer: fine)` — a tap on a touch device triggers `:hover`, which is almost never the intent. (Tailwind v4 does this by default; v3 needs `future.hoverOnlyWhenSupported`.)
- **Information revealed on hover is also revealed on `:focus-visible`**, so keyboard users get it.
- **Tap targets ≥ 44×44px.** Enlarge small controls with an invisible `::before` hitbox instead of changing layout.
- **Touch has no hover.** Where hover conveys information, check for `pointer: coarse` and split it into two taps — the first reveals what hover would, the second acts.
- **Fake placeholders** (an element animated to look like a placeholder): keep the real `placeholder` attribute for screen readers and `aria-hidden` the decorative copy.
