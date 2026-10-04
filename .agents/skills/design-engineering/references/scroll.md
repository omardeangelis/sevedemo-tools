# Scroll Animations

Scroll-linked motion is overused more than any other kind, so restraint comes before technique here. Scrolling is the user's own input: motion may react to it, but it must never take control of it or hold content back.

## Gate — does this deserve a scroll animation?

```
Product surface (app, dashboard, internal tool)?
├── Yes → nothing scroll-triggered. People scroll product screens all day;
│         content arriving late feels like a slow app, not a nice touch.
└── No — marketing surface (landing page, blog, documentation)
    ├── Already visible when the page loads?
    │   └── Yes → no scroll reveal. Give it a one-time load intro or keep it
    │             static — the first screen never waits on a scroll event.
    ├── Planning a reveal on every section?
    │   └── Yes → keep two to four per page. Each extra reveal weakens the others.
    └── Does the motion explain, set the pace, or point at something?
        ├── Yes → build it, following the rules below.
        └── No → keep it static.
```

Marketing pages may be more expressive because visitors see them rarely — which is exactly why each animated moment has to be chosen, not sprinkled.

## Two mechanisms

- **Triggered** — crossing a visibility threshold kicks off an ordinary animation with its own easing and duration ("this card fades up when it comes into view").
- **Scrubbed** — scroll progress drives the animation directly, frame for frame, and running backwards when the user scrolls up (reading-progress bars, parallax, pinned sequences).

Choosing the wrong one can't be fixed by tuning. A scrubbed animation gets **no duration and no easing**: the scrolling hand already supplies the timing, and an added duration makes it trail the scrollbar — the same disconnected feeling as a drag that lags the finger.

## Triggered reveals

- **Play once.** Replaying on every scroll up and down becomes a twitch and makes text flash while people read. Stop observing the element once it has animated (Motion: `useInView(ref, { once: true })`).
- **Values:** start at `opacity: 0` with a 10–16px downward offset and settle with a strong ease-out such as `--ease-out-expo`, over **400–600ms**. The 200ms that suits product UI feels jumpy on a landing page.
- **Fire slightly early** — when roughly 10–20% of the element has entered (`rootMargin: "0px 0px -10% 0px"`) — so the motion happens while the reader arrives rather than after they've looked at an empty gap.
- **Stagger siblings by ~80–120ms**, weighted by importance: the heading moves first and farthest, body copy follows, minor items may only fade.
- **Visible by default.** The markup without JavaScript shows the content; the script applies the hidden starting state immediately before animating. If the script fails, nothing should stay invisible.
- **One entrance per container** — animate the section or its children, never both.
- **Detection:** `IntersectionObserver` (or `useInView`) toggling a class or attribute. Not a scroll event handler — that runs on every frame on the main thread to answer a question an observer answers once. No heavy dependency just to detect visibility. For images, revealing with `clip-path: inset(…)` (from `inset(100% 0 0 0)` to `inset(0)`) is cheaper than animating height.

## Scrubbed animations

In order of preference:

1. **Native scroll-driven CSS** — `animation-timeline: view()` follows the element's own passage through the viewport; `scroll()` follows a scroll container. It runs off the main thread, keeps up even while the page is busy, and needs no script. Wrap it so unsupported browsers simply show the static state:

   ```css
   @supports (animation-timeline: view()) {
     .chart {
       animation: chart-rise linear both;
       animation-timeline: view();
       animation-range: entry 10% cover 50%;
     }
   }
   ```

   This is the one place `linear` is required: any curve would bend the one-to-one relation between scroll and progress.
2. **Motion's `useScroll` + `useTransform`** — when scroll progress also has to drive component logic or combine with springs and gestures. It runs on the main thread, so it can stutter while the page is busy.
3. **A scroll handler that sets framework state** — never; it re-renders for every pixel scrolled.

## Parallax

- Keep the speed difference between layers **at or below ~15%** of the scroll distance — beyond that content appears to float loose.
- Transforms only, scrubbed, and only on decorative layers — never on text someone is reading.
- **Turn it off completely under `prefers-reduced-motion`**: it is decorative and a common trigger for motion sickness, so its reduced form is no motion.
- **Leave it out on phones**, where small viewports and inertial scrolling turn it into wobble.

## Pinned sequences

A section that stays pinned while scrolling advances its content is a teaching device; it justifies the extra scroll only when every stretch of scrolling moves the story forward.

- Progress moves in one direction with the scroll and rewinds when scrolling back.
- Limit the pinned distance to about two or three viewport heights; longer feels like being stuck.
- Continuing to scroll must always get the user past it — never slow down or block scrolling to force the sequence.

## Don't take over scrolling

No scroll-jacking, no rewriting wheel input, no "each wheel notch jumps a full screen". Libraries that reimplement scrolling in JavaScript swap native responsiveness for a floaty feel that many people experience as lag. Smooth scrolling for in-page anchors is allowed only behind `prefers-reduced-motion: no-preference` (see `accessibility.md`).

## Performance

Stick to `transform` and `opacity`; on a scrolling page, layout work piles on top of the scroll itself. `will-change: transform` pays off on scrubbed elements, which animate for the entire scroll, and is wasted on one-off reveals. Any animated blur stays at or below ~20px.

## Reduced motion

Triggered reveals keep their fade and lose the offset; decorative scrubbed motion (parallax, drifting shapes) is disabled; smooth scrolling is disabled.
