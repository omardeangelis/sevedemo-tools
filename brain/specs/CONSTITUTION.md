---
domain: _root
type: index
links: []
created: 2026-06-12
updated: 2026-09-16
---

# Constitution — Spec-Driven Implementation Rules

Repo-level rules and sanity checks that every spec-driven skill (`create-spec`, `create-plan`, `implement-spec`, `docs-maintenance`) must respect. Keep this short; the detailed, always-current version of the project rules lives in the repo-root `AGENTS.md` (**Project guidelines**).

## Non-negotiables

- Specs live in the problem space: they define the *what* and *why*, never the *how*.
- One `SPEC.md` maps to one capability/epic; when child stories exist, their requirements are unified beneath it.
- No code is written during `create-spec` or `create-plan`. Implementation happens only in `implement-spec`.
- Tests describe behavior through public interfaces (see `tdd`). No horizontal slicing (all-tests-then-all-code).
- Persistent implementation drift is tracked in `tech-debt/<domain>/<spec>.md`, not buried in spec folders.
- Domain knowledge in `domains/` is written by `docs-maintenance`, not hand-authored.

## Project sanity checks

- **Gates before declaring a task done** (all green): `npm run typecheck` (src + tests + scripts), `npm test`
  (vitest), `npm --prefix web run build`, then `npm --prefix web run typecheck` (it needs the route tree the
  build generates).
- **Server changes** go RED → GREEN in vitest through public interfaces (`createApp().request()`, exported
  functions) on the per-process temp DB of `tests/setup.ts`, with dynamic `await import()` for modules that read
  the config. Jobs use injected `deps`, actors use pure mappers + JSON fixtures, Claude uses an injected client:
  **no real Apify/Anthropic calls** in tests or validation.
- **Frontend changes** have no test runner: `npm --prefix web run typecheck` + `agent-browser` scenarios against
  `npm run e2e:server` (fake jobs, temp DB; see `tests/e2e/README.md`). The spec's `FLOW.md` copy, error/edge
  paths and accessibility notes are part of the acceptance surface.
- **Ownership boundaries** (no co-edit between parallel tasks): one router per file in `src/server/routes/`,
  one job kind per file in `src/jobs/`; `src/server/app.ts` and `src/jobs/handlers.ts` are wiring only.
  `web/src/routeTree.gen.ts` is generated and never edited by hand.
- **Contracts that must not be bypassed**: actor inputs only in `src/apify/actors.ts`; prospect identity only
  through `upsertProspect` / `src/db/identity.ts` (never dedupe on raw URLs); every paid job exposes the uniform
  preview (`blockers` stop the start, unknown cost = `null`); one job at a time (400 `blocked` for configuration,
  409 `job_running` for a running job); status changes are manual and logged as activities.
- **Review gate**: before finalizing a spec implementation, run `adversarial-review` (case B) on it.
