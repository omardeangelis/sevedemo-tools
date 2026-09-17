# AGENTS.md

Guidance for AI coding agents working in this repo. The knowledge base and the
spec-driven skill suite live under `brain/` — start with `create-spec`, and read
`brain/AGENTS.md` for how to operate inside `brain/`.

## Project guidelines

Personal LinkedIn prospecting CRM: single user, local, no auth. Root = TS/Node ESM (`tsx`), SQLite
(`better-sqlite3`), Hono API in `src/server/`; `web/` = React 19 + TanStack Router/Query + Tailwind 4 +
shadcn/Radix (Vite). Domain contract: `brain/domains/prospect-crm/prospect-crm-contract.md`. User-facing
setup, costs and env vars: `README.md`.

### Gates (all green before declaring a change done)

```bash
npm run typecheck              # tsc on src/ + tests/ + scripts/
npm test                       # vitest, tests/*.test.ts
npm --prefix web run build     # also regenerates web/src/routeTree.gen.ts (untracked)
npm --prefix web run typecheck # run after a build: main.tsx imports the generated route tree
```

### Tests

- **Server = vitest.** `tests/setup.ts` gives each vitest process its own temp `DB_PATH` and fake API keys.
  `src/config.ts` is read at import time: import DB/config-touching modules with dynamic `await import()`,
  never hoisted static imports. HTTP through `createApp().request()`; test public interfaces, not internals.
- Jobs: pure functions with injected `deps` (`syncInteractions(params, deps)`, …) or the spawn override
  `{command, args}`. Actors: pure mappers + JSON fixtures in `tests/fixtures/`. Claude: injected `client`.
  Apollo: injected `fetch` in `createApolloClient`, raw-JSON `Deps` + fixtures in `tests/fixtures/apollo/`.
  **Never call real Apify, Anthropic or Apollo** from tests or validation (`npm run apollo:smoke` is run
  manually by the user: it spends credits).
- **Frontend = no test runner.** Validate with `agent-browser` against the fake server:
  `UI_PORT=<api port> npm run e2e:server` (own temp DB per port, `E2E_FAKE_JOBS=1`, `.env` ignored, refuses
  `DB_PATH` inside `data/`) + `API_URL=http://localhost:<api port> npm --prefix web run dev -- --port <vite
  port> --strictPort`. Seed/reset endpoints, dataset and failure triggers (Apollo: `apollo-…` words in the
  data, `E2E_NO_APOLLO=1`): `tests/e2e/README.md`.
  Gotchas: agent-browser pages are `visibilityState=hidden` (dialog close animations finish only after a
  screenshot); Vite dev misses Tailwind classes of route files created after it started (restart it).
- Stop every server/Vite/agent-browser session you start, **by PID** (never `pkill -f` a shared pattern:
  parallel agents run the same scripts).

### Architecture rules

- **Actor inputs only in `src/apify/actors.ts`** (IDs + input builders). Outputs are read tolerantly with
  `field()` in pure mappers under `src/acquisition/mappers/`.
- **Apollo request paths/bodies only in `src/apollo/requests.ts`**, executed by `src/apollo/client.ts`
  (rate-limit headers, 429 retries, `config:`/`actor:apollo:<op>:` errors, never logs key or bodies). Job
  `Deps` return the raw JSON; handlers map it with the tolerant mappers in `src/apollo/mappers/`.
- **One router per file, one job kind per file.** `src/server/routes/<name>.ts` exports
  `<name>Routes = new Hono<AppEnv>()` with paths written without `/api`; `src/server/app.ts` mounts them.
  `src/jobs/<kind>.ts` exports `Deps`, `handler`, `realDeps()`, `configBlockers(params)`;
  `src/jobs/handlers.ts` is the registry and `src/jobs/fake-deps.ts` the e2e deps. `app.ts` and
  `handlers.ts` are pre-wired: logic never goes there, and parallel tasks must not co-edit them. A new job
  kind = its own file + entries in `HANDLERS`/`REAL_DEPS`/`CONFIG_BLOCKERS` + `JOB_KINDS` (which drives the
  `CHECK` on `jobs.kind`) + a fake in `fake-deps.ts`. `configBlockers` is the single source of config
  blockers for preview, start and "Riprova" (`retryJob` → 400 `code:'blocked'`).
- **Prospect identity** — never compare or dedupe prospects on raw URLs. Keys: `linkedin_url` (UNIQUE,
  moves to the lower-cased public slug once known) + `member_urn` (`ACoAA…`, case-sensitive, unique if set).
  Create/update via `upsertProspect({linkedinUrl, memberUrn, …}, {refresh?, linkByName?})` →
  `{id, created, mergedIds}` (`src/db/prospects.ts`); fix keys with `setProspectIdentity` /
  `mergeProspects` (`src/db/identity.ts`); parse with `normalizeLinkedinUrl`, `memberIdOf`, `profileKeys`
  (`src/util/fields.ts`). Always pass the mapper's `memberUrn` through. An id you hold can vanish after a
  merge: re-read it and handle "not found".
- **Company identity** — never compare or dedupe companies on raw URLs or websites. Keys: `linkedin_url`
  (`normalizeCompanyUrl`) | `domain` (`normalizeDomain`, `src/util/fields.ts`): at least one (CHECK), each
  UNIQUE. `apollo_org_id` is UNIQUE and matched by `upsertCompany`, but never enough to create a company;
  set = Apollo-enriched (`apollo_enriched_at` alone = attempted). Manual create/edit via `createCompany` /
  `updateCompany` (`CompanyKeysError`, `CompanyKeyTakenError` → 409 `company_exists`); jobs via
  `upsertCompany(input, {refresh?})` → `{id, created, mergedIds, keyConflict, noKeys, …}` (merge rules,
  `src/db/companies.ts`); merges via `mergeCompanies(keepId, dropId)` (`src/db/company-identity.ts`). Company
  ids can vanish after a merge too.
- SQLite is the only source of truth; derived states (Inbox, enriched, stale analysis) stay derived, never
  columns. Enums live in `src/db/schema.ts`; timestamps are ISO strings from `nowIso()`.
- **Schema changes on existing DBs** go through `planSchemaMigration` + `migrateSchema` (`src/db/schema.ts`,
  run by `applySchema` on import of `src/db/index.ts`, child processes included): CHECK/NOT NULL changes =
  table rebuild (`rebuildTableSteps`/`rebuildTable`) after one `backupDatabase` per process
  (`<db>.bak-<ISO>`, refused while a job pid is alive), all in one transaction ending in
  `foreign_key_check`; additive columns = guarded `ALTER TABLE … ADD COLUMN` (`PRAGMA table_info`, like
  `ensureColumn`). Must stay idempotent: no-op and no backup on new or already migrated DBs. New values in
  `JOB_KINDS`/`SOURCE_KINDS` already trigger the rebuild.
- Status changes are always manual and always write a `status_change` activity. AI is used only for
  the prospect analysis (structured outputs, `max_tokens` 16 000, model from `ANALYSIS_MODEL`).

### API conventions

- Use `src/server/http.ts`: `readJson(c, schema)` (zod **v4**, `.strict()` objects → 400
  `{error, issues[]}`), `idParam(c)` (404 on bad ids), `throw httpError(status, message, extra?)`.
- Error body is always `{error: '<Italian message>', code?: '<snake_case>', …extra}`. Responses use DB
  column names (snake_case, JSON columns parsed); collections `{items}` (+ `total, page, pageSize` when
  paginated); create → 201 + entity; deletes → `{ok: true}`.
- Jobs: **one at a time**. Every kind has a preview `{counts, est_cost_usd: number | null, warnings,
  blockers}` (unknown cost = `null`, never invented). Start → 202 `{job}` via `launchJob()`; config
  blockers (missing token/profile, archived list) → **400 `code:'blocked'`**; a job already running →
  **409 `code:'job_running'`**. Job errors are prefixed `actor:<id>:` / `config:` / `process:`.

### Frontend

- `web/src/routeTree.gen.ts` is generated: never edit it or resolve conflicts by hand.
- API calls/types in `web/src/api/{client,types}.ts`; job hooks in `web/src/lib/jobs.ts`; paid actions go
  through `JobPreviewDialog` ("Avvia" disabled on blockers). Toasts: `toast` from
  `web/src/components/ui/toaster.tsx` (not the legacy `pushToast`). Filters live in the URL.
- UI copy, code comments and error messages are **Italian**. The `FLOW.md` of `brain/specs/prospect-crm/`
  `crm-foundation/` and `apollo-lookalike/`: copy, error/edge paths and accessibility notes are part of the
  acceptance surface.

### Tooling

- Root `node_modules` is **pnpm-managed** (`pnpm-lock.yaml`) even though scripts run as `npm run …`.
  Install with `/usr/local/bin/pnpm` (10.x): the `pnpm` 9.x on PATH fails with `ERR_PNPM_UNEXPECTED_STORE`.
  `web/` uses **npm** (`web/package-lock.json`). Don't add dependencies without a reason.
- Real data lives in `data/crm.db` (legacy `data/sevedemo.db` is never read): tests and e2e never touch
  `data/`.
