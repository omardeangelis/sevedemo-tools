# Picking the Tool

Before writing anything, check what already exists — a proven component or pattern almost always beats a new invention. What follows is a deliberately short, opinionated list.

## Ground rules

1. **Start from the project** — the stack profile `brain/chore/motion-stack.md`, `package.json` (or the stack's equivalent), and the root `AGENTS.md`. The tables below name React tools; on another stack, take the equivalents from the profile's Translation table. If something already installed does the job, use it. Suggesting another animation library, or another set of UI primitives, next to the existing one is itself a problem to flag.
2. **Answer the actual need.** A request for a toast gets a toast answer, even if an animation library was mentioned.
3. **Give one answer.** Offer alternatives only on request.
4. **No installs on your own initiative** in a brain project. If something truly seems missing, present it with its trade-off and let the user decide.
5. **Be explicit when you leave this list** — say so before naming something not covered here.

## Which mechanism for which animation

| Animation | Mechanism | Reason |
| --- | --- | --- |
| Reaction to the user — hover, click, open/close | CSS transition | Can reverse or retarget mid-flight |
| Fires repeatedly in quick succession — toast stacks, toggles, accordions, drawers | CSS transition or spring | Keyframes would restart and make items jump |
| Endless loop — marquee, spinner, orbit | CSS `@keyframes`, `infinite`, `linear` | Nothing more needed |
| Plays once by itself — load intro, text reveal, staggered entrance | CSS `@keyframes` with a fill mode | Delay per item from a CSS variable; no script |
| Simple enter/exit that can't be interrupted — dialog, popup | CSS keyframes or `@starting-style` | No mount flag or effect hook needed |
| Has to stay smooth while JavaScript is busy | CSS or WAAPI | Runs off the main thread |
| Driven from code, still accelerated, next to the logic that triggers it | WAAPI | Script control without a rAF loop |
| Real springs, momentum, redirection that keeps velocity | Motion for React (vanilla Motion outside React) | CSS can only approximate springs |
| Exit animation after a component is removed | Motion — `AnimatePresence` | Once removed from the DOM, CSS has nothing to animate |
| One element turning into another — shared element, tab underline, card → detail | Motion — `layout` / `layoutId` | Beyond what CSS can animate |
| Dragging with momentum, drag-to-dismiss | Motion — `drag` | Momentum built in |
| Reveal on scroll when Motion isn't in the project | `IntersectionObserver` | No library needed to detect visibility |
| Progress tied to scroll position | CSS `animation-timeline` behind `@supports` | Off the main thread |
| Full-page theme switch or page-to-page transition | View Transitions API | Does natively what clip-path tricks imitate |

In short: **CSS for simple motion and anything that must stay accelerated; Motion for rich, dynamic, or gesture-driven motion** — and using both in one codebase is normal. Users notice the result, not the technique: if the right result needs a library the project can afford, use it. Frame drops come from animating expensive properties, not from JavaScript as such.

### The JavaScript options

- **Motion for React** (`motion/react`) — springs, layout and shared-layout animation, lots of motion in little code, idiomatic in React. Downsides: bundle weight and opaque "magic" when something breaks. Stay with the declarative props; `useAnimate` is rarely worth its upkeep.
- **React Spring** — physics-first, lighter, highly tunable, works well with `use-gesture`. Downsides: harder to learn, more code per effect, tougher docs. Choose it when fine spring control outweighs writing speed.
- **GSAP** — framework-independent, superb timelines, easy to pick up, free. Downsides: no springs, not React-native in style. Good for timeline-driven marketing pieces, not for product UI that needs springs.

## Don't build these from scratch

Dropdowns, selects, menus, dialogs, tooltips, tabs, and toasts are deceptively hard — keyboard support, focus handling, ARIA. Use unstyled primitives and keep the visual design your own:

| Need | React options |
| --- | --- |
| Dropdown, navigation menu, dialog, tooltip, tabs, select, popover | Radix Primitives, Base UI, or React Aria — whichever the project already uses |
| Toasts | Sonner |
| Bottom sheet / drawer with a native iOS feel | Vaul |

These primitives make motion easier too: CSS variables for the correct `transform-origin`, state attributes to hook exit animations onto, direction attributes for navigation menus, and an attribute that lets follow-up tooltips skip their animation. A library slowing its release pace isn't a reason to migrate on its own — working code keeps working and can be patched. In other frameworks, use the equivalents the project already has — the stack profile lists them (rows 13–15).

## Helpers

| Need | Use |
| --- | --- |
| Measuring content to animate its height | `react-use-measure`, or a small `ResizeObserver` hook |
| Closing on outside click | The project's existing hook, else `useOnClickOutside` from `usehooks-ts` |
| Hover only for real pointers | Tailwind v4 (default behavior) or the `(hover: hover) and (pointer: fine)` media query |
| Tweaking motion values live while exploring | A dev-only tuning panel (e.g. DialKit) — in prototypes only, never shipped |

## Is the dependency worth it?

- **Count the work it saves.** A well-built navigation menu took someone weeks; you won't match it in an afternoon.
- **Weight is a trade-off, not an automatic no.** Decide it explicitly (a drawer library might skip a spring engine to stay small and accept slightly less natural snapping).
- **Ignore hype.** The question is which problem it solves in this project, not how popular it is right now.

## Flag when you see

- A home-made toast, drawer, dropdown, select, or tooltip with hand-written focus and keyboard logic.
- An animation library brought in for a basic hover or fade.
- A second animation library alongside one that's already there.
- `@keyframes` on anything that can fire again while it's still running.
- A large dependency used only to detect when something scrolls into view.
