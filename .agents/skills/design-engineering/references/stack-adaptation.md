# Stack Adaptation

The references write their framework-specific code for **React with Motion for React**: the Motion section of `implementation.md`, the Motion hooks in `accessibility.md`, the primitives in `library-pick.md`, and a few lines in `gestures.md`, `review.md`, `diagnose.md`, and `vocabulary.md`. Everything else is framework-neutral: the gate, curves, durations, spring feel, CSS, WAAPI, and every procedure.

This procedure finds the project's UI stack. For anything other than React on the web, it researches that stack's own equivalents and writes them down once, in `brain/chore/motion-stack.md`. Every later motion task then translates through the profile instead of guessing.

## When to run

- **During `init-brain`**, which calls this right after installing the suite.
- **When a motion task starts and the profile is missing or stale.** Stale means the profile's Framework row no longer matches the project's manifests: the project migrated, a new app joined the monorepo, or a motion library was added or removed.
- **On request** ("re-run the stack adaptation").

Outside a brain project, run the same steps but put the translation in your answer instead of writing a file.

A subagent that can neither ask the user nor search the web does not run this. It reports "stack profile missing" to its orchestrator and keeps its advice framework-neutral in the meantime (CSS, WAAPI, vanilla `motion`).

## 1. Detect

Base the stack on evidence, never on an assumption.

- **Manifests.** `brain scan` prints a `frontend` line per manifest and a verdict note. Without the CLI, read the manifests yourself:
  - every `package.json` outside `node_modules` (root and workspace apps);
  - `pubspec.yaml`;
  - `*.xcodeproj` / `Package.swift`;
  - `build.gradle(.kts)`.
- **Exact versions** come from the lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`), not from the declared range.
- **Also record:**
  - the rendering model: SPA, SSR with hydration, islands, or server templates;
  - the styling system;
  - animation and gesture libraries;
  - UI primitives, toast and drawer libraries;
  - the motion tokens already in the code (search for `cubic-bezier`, `--ease`, `--duration`, and `transition`, or the stack's equivalents).

## 2. Confirm, or ask

**One clear framework:** state it and continue. No question is needed.

**Otherwise ask one question**, with the detected candidates as options and your recommendation first (in Claude Code, use `AskUserQuestion`). Ask when:

- **nothing is detected.** The UI may live in another repo or in server templates (Django, Rails, Laravel, Phoenix), or the project may have no UI at all.
- **there are several frontends.** Ask which are in scope; each one gets its own section in the profile.
- **detection contradicts** the root `AGENTS.md` or a tech-stack note in `brain/chore/`.

Never guess past an unanswered question: the profile would carry the guess into every later task.

## 3. Pick the branch

### React on the web

Covers Next, Remix / React Router, Gatsby, TanStack Start, and Astro with React-only islands.

Write a short profile: the references apply as written, so no research is needed.

- Record which of Motion, the primitives, Sonner, and Vaul are installed.
- For each React library the references rely on but the project lacks, note the in-project route (CSS or WAAPI) and list the dependency under Open decisions.

### Any other web stack

Covers Vue / Nuxt, Svelte / SvelteKit, Angular, Solid, Preact, Qwik, Lit / web components, Astro, Ember, and no framework at all (vanilla, htmx, Alpine, Stimulus, server templates).

Write a full profile: research every row of the checklist. The CSS sections still apply as written.

### Native or cross-platform

Covers React Native, Flutter, SwiftUI / UIKit, and Jetpack Compose.

Write a full profile, scoped to the platform:

- **These transfer:** the gate, curves, durations, spring feel, gesture physics, and every procedure.
- **These get replaced by the platform's own model, not translated line by line:** the browser material, meaning property cost tiers, `@starting-style`, `animation-timeline`, hover media queries, and `will-change`.

### No UI

Write a profile with `Framework: none`. The skill stays dormant until a UI appears.

## 4. Research (stacks other than React on the web)

### Rules

1. **Primary sources, at the installed version.** Use official docs and the library's repository and changelog, through whatever documentation tooling the session has: a docs MCP such as Context7, or web search plus fetch. Memory is a lead, not a source. Animation APIs move fast: packages get renamed, animation modules get deprecated, and new built-ins appear.
2. **Every row gets a source URL and a status:**
   - `verified (vX)`;
   - `unverified`, with what is uncertain;
   - `none → fallback`, naming the framework-neutral route when the stack has no idiomatic equivalent.
3. **Fill each row from the first available option:**
   1. what the project already has installed;
   2. what the framework has built in;
   3. a maintained library for this framework;
   4. a framework-agnostic route (vanilla `motion`, WAAPI, CSS).

   Before naming a library, check that it is maintained: its last release, and whether it supports the installed major version.
4. **No installs, no edits to this skill.** Anything that needs a dependency goes under Open decisions, with its trade-off.
5. **Bound the effort to the checklist.** If a row takes more than a couple of searches, mark it `unverified` and move on.

### Checklist

Each row is something the references express in React terms.

| # | Concept | How the references write it | Used in |
| --- | --- | --- | --- |
| 1 | Enter/exit of an element leaving the tree | `AnimatePresence` | implementation, review, diagnose |
| 2 | List enter/exit and reorder (FLIP) | `layout` on list items inside `AnimatePresence` | implementation |
| 3 | Shared element / one element morphing into another | `layout`, `layoutId` | implementation, library-pick, vocabulary |
| 4 | Interruptible spring that keeps velocity | `transition: { type: "spring", duration, bounce }` | standards §5, implementation |
| 5 | Per-frame values without re-rendering | `useMotionValue`, `useTransform`, `useSpring`; direct `style` writes | implementation, gestures, performance |
| 6 | Drag with momentum, drag-to-dismiss | Motion `drag`, `dragElastic`, release velocity | gestures |
| 7 | Reduced motion: global switch and per-component branch | `MotionConfig reducedMotion="user"`, `useReducedMotion()` | accessibility |
| 8 | Animating to or from `auto` height | measure with `react-use-measure` or a `ResizeObserver` hook | implementation, diagnose |
| 9 | Replaying a keyframe animation | a new `key` remounts the element | implementation |
| 10 | The re-render trap | framework state set on every frame | performance, diagnose |
| 11 | Enter on mount without JS state | `@starting-style`, framework-neutral; check how SSR, hydration, and the stack's own transition system interact with it | implementation |
| 12 | Route and page transitions | View Transitions API | library-pick |
| 13 | Unstyled accessible primitives, with their origin variables and state attributes | Radix, Base UI, React Aria | library-pick, standards, gestures |
| 14 | Toast | Sonner | library-pick |
| 15 | Drawer / bottom sheet | Vaul | gestures, library-pick |
| 16 | Outside click | `useOnClickOutside` | library-pick |
| 17 | Live tuning panel for prototypes | DialKit | library-pick, prototype |

Native stacks add these rows:

| # | Concept | Web original |
| --- | --- | --- |
| N1 | The curve type that carries a `cubic-bezier(…)` value | CSS `cubic-bezier` |
| N2 | Spring configured by duration/bounce or stiffness/damping | Motion spring |
| N3 | The OS reduce-motion setting and how to read it | `prefers-reduced-motion` |
| N4 | What is cheap to animate, and what runs off the UI thread | composite-only property tiers |
| N5 | A gesture system that reports velocity | pointer events |
| N6 | Hero / shared-element transition | `layoutId` |

### Where to start looking

These are leads, not answers: confirm each against the installed version before it goes into the profile.

| Stack | Leads |
| --- | --- |
| Vue / Nuxt | `<Transition>`, `<TransitionGroup>` (its move class does FLIP); Motion for Vue (`motion-v`); VueUse (`useElementSize`, `onClickOutside`, `usePreferredReducedMotion`); Reka UI (formerly Radix Vue); `vue-sonner`, `vaul-vue`; Nuxt's view-transition support |
| Svelte / SvelteKit | `transition:` / `in:` / `out:`, `animate:flip`; `svelte/motion` (spring and tween; recent versions add a reduced-motion helper); `bind:clientHeight`; Bits UI, Melt UI; `svelte-sonner`, `vaul-svelte`; SvelteKit `onNavigate` with `document.startViewTransition` |
| Angular | Recent releases are moving from `@angular/animations` to built-in enter/leave hooks, so check which the installed version recommends. Also: Angular CDK (overlay, drag-drop, a11y); router view transitions; running per-frame work outside change detection |
| Solid | `solid-transition-group`; Motion One for Solid; Kobalte, Corvu (drawer); a maintained Sonner port; signals for per-frame values |
| Preact | `preact/compat` runs some React libraries. Verify each one (Motion, primitives) instead of assuming |
| Lit / web components / vanilla / htmx / Alpine / Stimulus | The CSS sections apply fully. For JS-driven motion, vanilla `motion` (`animate`, `inView`, `scroll`) or WAAPI. htmx and Alpine have their own transition hooks. Primitives come from the platform (`<dialog>`, `popover`) |
| Astro | `.astro` pages use the CSS sections plus Astro's view-transition routing (`transition:name`, `transition:animate`). Each island follows its own framework's row |
| React Native / Expo | Reanimated (shared values, `withTiming` / `withSpring`, `Easing.bezier`, `entering` / `exiting` layout animations, a reduced-motion hook); Gesture Handler; `@gorhom/bottom-sheet`; `AccessibilityInfo` |
| Flutter | Implicit `Animated*` widgets; `AnimationController` with `CurvedAnimation`; `Cubic`; spring simulations; `Hero`; `AnimatedSwitcher`; `MediaQuery`'s disable-animations flag |
| SwiftUI | `withAnimation`; `.animation(_:value:)`; `.timingCurve`; springs by duration and bounce; `matchedGeometryEffect`; `.transition`; `accessibilityReduceMotion` |
| Jetpack Compose | `animate*AsState`; `AnimatedVisibility`; `AnimatedContent`; `spring()`; `tween` with `CubicBezierEasing`; shared-element transitions; the system animator-scale setting |

## 5. Write the profile

Write `brain/chore/motion-stack.md` from this template:

```md
---
domain: _root
type: concept
links: ["[[index]]"]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Motion stack profile

Written by the design-engineering stack adaptation. Regenerate it when the stack changes instead of patching rows by hand. Taste decisions (personality, chosen values, deliberate deviations) belong in `motion.md`, not here.

## Stack

| | Value | Evidence |
| --- | --- | --- |
| Framework | Vue 3.5.13 (Nuxt 3.14.1) | `package.json`, `pnpm-lock.yaml` |
| Rendering | SSR with hydration | `nuxt.config.ts` |
| Styling | Tailwind 4.1 | `package.json` |
| Motion / gestures | none | — |
| UI primitives | Reka UI 2.0, vue-sonner 1.3 | `package.json` |
| Motion tokens | `--ease-out` in `assets/css/tokens.css:12` | grep |
| Scope | `apps/web` | single frontend / confirmed by the user |

## How the references apply

- **As written:** the gate and values (`standards.md`), the procedures (`review`, `audit`, `opportunities`, `diagnose`, `motion-brief`), and the CSS material.
- **Through the translation below:** every React or Motion API the references name.
- **Not applicable:** what this stack replaces (native stacks: the browser material).

## Translation

| # | Concept | References (React) | This project | Source | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Exit after removal | `AnimatePresence` | `<Transition>` around the `v-if`; `<TransitionGroup>` for lists | https://vuejs.org/guide/built-ins/transition.html | verified (3.5) |

## Stack-specific traps

What breaks motion in this stack and has no React counterpart (for example, a transition wrapper that needs exactly one root element, or change detection running on every animation frame).

## Open decisions

Rows that need a dependency, each with its trade-off. The user decides; nothing was installed.
```

Then follow the brain conventions:

1. Add the page under "Chore" in `brain/index.md`.
2. Append an entry to `brain/log.md`.
3. Report to the user:
   - the detected stack;
   - the rows marked `unverified` or `none`;
   - the open decisions.

## 6. Using the profile

- **Read it before giving or writing framework-specific code**, and route every React API in the references through its Translation table. Values never change with the stack: the curve, duration, and spring feel stay the same, and only the API that carries them changes.
- **An `unverified` row:** use it, but say so. Where a mistake would matter, prefer the framework-neutral route.
- **A `none → fallback` row:** use the fallback. Never invent an API the stack doesn't have.
- **A stale profile** (the framework or a motion library changed): run this procedure again before advising.
