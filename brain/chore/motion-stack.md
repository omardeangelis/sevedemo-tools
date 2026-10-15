---
domain: _root
type: concept
links: ["[[index]]"]
created: 2026-10-03
updated: 2026-10-03
---

# Motion stack profile

Written by the design-engineering stack adaptation. Regenerate it when the stack changes instead of patching rows by hand. Taste decisions (personality, chosen values, deliberate deviations) belong in `motion.md`, not here.

## Stack

| | Value | Evidence |
| --- | --- | --- |
| Framework | React 19.2.7 | `web/package.json`, `web/package-lock.json` |
| Rendering | SPA (Vite 8, TanStack Router 1.170), no SSR | `web/package.json`, `web/vite.config.ts` |
| Styling | Tailwind 4.3 + `tw-animate-css` 1.4 (`animate-in`/`animate-out`, `fade-in-0`, `zoom-in-95`) | `web/package.json`, `web/src/styles.css:2` |
| Motion / gestures | none (no Motion for React, no gesture library) | `web/package.json` |
| UI primitives | shadcn (`radix-nova` style) on `radix-ui` 1.6.0 — state via `data-open` / `data-closed` / `data-state`; toasts are an in-house `toaster.tsx` (no Sonner); no Vaul | `web/components.json`, `web/src/components/ui/` |
| Motion tokens | none: no `cubic-bezier`, `--ease-*` or `--duration-*` in `web/src`. The shadcn primitives use `duration-100` + `tw-animate-css` keyframes (e.g. `web/src/components/ui/dialog.tsx:62`); buttons use `transition-all` + `active:translate-y-px` (`web/src/components/ui/button.tsx:8`) | grep |
| Scope | `web/` | single frontend |

## How the references apply

- **As written:** the gate and values (`standards.md`), the procedures (`review`, `audit`, `opportunities`, `diagnose`, `motion-brief`), and the CSS material (transitions, `@starting-style`, `tw-animate-css` classes on Radix data attributes).
- **Through the routes below:** every Motion for React API the references name — the project has no Motion, so each one maps to CSS or WAAPI.
- **Not applicable:** gestures (desktop-only, single-user tool: no drag/swipe surfaces).

## Translation

| # | Concept | References (React) | This project | Status |
| --- | --- | --- | --- | --- |
| 1 | Exit after removal | `AnimatePresence` | Radix primitives: `data-closed:animate-out` (they delay unmount). Plain elements: keep them mounted while a CSS transition runs, then remove (state flag + `transitionend`), or skip the exit | none → fallback |
| 2 | List enter/exit, reorder | `layout` in `AnimatePresence` | `@starting-style` for enter; exits as #1; no FLIP — avoid reorder animations | none → fallback |
| 3 | Shared element | `layoutId` | not used; View Transitions API only if ever needed | none → fallback |
| 4 | Interruptible spring | Motion spring | CSS `transition` with a `cubic-bezier` (interruptible) | none → fallback |
| 7 | Reduced motion | `MotionConfig` / `useReducedMotion()` | `motion-safe:` / `motion-reduce:` Tailwind variants, `@media (prefers-reduced-motion: reduce)` | verified (Tailwind 4) |
| 8 | Height to/from `auto` | measure | `interpolate-size: allow-keywords` (progressive) or `grid-template-rows: 0fr → 1fr` | none → fallback |
| 11 | Enter on mount | `@starting-style` | `@starting-style` (SPA, no hydration caveat) or `tw-animate-css` `animate-in` | verified |
| 13 | Primitives | Radix | `radix-ui` 1.6 via shadcn (`npx shadcn@latest add <name>` from `web/`) | verified (1.6.0) |
| 14 | Toast | Sonner | in-house `web/src/components/ui/toaster.tsx` (`toast({...})`) | verified |

## Stack-specific traps

- Vite dev misses Tailwind classes in files created after it started (restart it) — see root `AGENTS.md`.
- `agent-browser` pages are `visibilityState=hidden`: CSS animations/transitions only finish after a screenshot, so motion can't be judged there — feel-checks need a real browser.

## Open decisions

- No motion library: anything beyond CSS/WAAPI (springs with velocity, FLIP lists) would need `motion` — not proposed; the product is a daily-use tool where crisp CSS is enough.
