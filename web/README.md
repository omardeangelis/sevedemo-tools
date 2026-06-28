# sevedemo-web

React 19 + TanStack Router/Query + Tailwind v4 + Vite frontend for SeVedemo tools.

## Component standard

**shadcn/ui is the going-forward component standard.** New components live under
`@/components/ui` (radix-based, Tailwind v4 CSS variables, `cn()` from `@/lib/utils`).
Add more with `npx shadcn@latest add <name>` (run from `web/`).

The legacy custom helpers in `src/components/ui.tsx` (`btn`, `Card`, `Badge`, `Modal`, …)
still work and coexist; migrate them to shadcn incrementally — no big-bang rewrite.

Path alias `@/` → `src/` is configured in `tsconfig.json` (`paths`) and `vite.config.ts`
(`resolve.alias`).
