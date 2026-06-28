---
domain: lead-engine
type: review
scope: spec
spec: selections-filters-ux
review_target: spec implementation
base_ref: working-tree HEAD (brain-upgrade)
head_ref: uncommitted working tree
verdict: ship
review_impact: critical
human_in_loop: true
links:
  - "[[specs/lead-engine/selections-filters-ux/RUBRIC]]"
  - "[[specs/lead-engine/selections-filters-ux/SPEC]]"
  - "[[specs/lead-engine/selections-filters-ux/PLAN]]"
  - "[[specs/lead-engine/selections-filters-ux/FLOW]]"
  - "[[specs/lead-engine/selections-filters-ux/IMPLEMENTATION-NOTES]]"
ingested: false
last_ingested: null
created: 2026-06-16
updated: 2026-06-16
---

# Review Report: selections-filters-ux (spec implementation)

## Verdict

**SHIP** · impact: critical

At review time one verifier (v3) returned **DO NOT SHIP** on a MAJOR URL-hygiene finding (the `emailReady`
field serialized as `emailReady=%221%22` instead of a clean value, violating the documented
"URL puliti e condivisibili" invariant) plus a MINOR loose-validation gap. **Both were fixed in-session
and re-verified** (see Resolution), so the consolidated verdict is **SHIP**. All other passes (v1, v2, v4,
v5) shipped with only nits/non-blocking minors.

## Coverage

- Rubric passes run: **5/5** — v1 (opus), v2 (opus), v3 (sonnet), v4 (sonnet), v5 (sonnet).
- Passes skipped or failed: none.

## Findings

| Severity | Concern (verifier) | Location | Problem | Required fix / evidence | Durable? |
|----------|--------------------|----------|---------|-------------------------|----------|
| MAJOR (resolved) | v3 — URL persistence | `web/src/routes/contacts.index.tsx` (emailReady) | `emailReady` typed as string `'1'`; TanStack Router re-JSON-encodes any JSON-parseable value, so `'1'` (parses as number 1) emitted `emailReady=%221%22` — violates the "URL puliti e condivisibili" invariant (stato-filtri-url). | **Fixed in-session**: `emailReady` retyped to `boolean`; `setEmailReady` writes `true`/`undefined`; `validateSearch` returns `s.emailReady === true ? true : undefined`; read as `=== true`. Re-verified via agent-browser: active URL = `emailReady=true` (raw param `"true"`), round-trips on reload, export href `email=with`, chip present, toggles clean, page preserved. | no (fixed) |
| MINOR (resolved) | v3 — URL persistence | `web/src/routes/contacts.index.tsx` validateSearch | `s.emailReady ? '1' : undefined` accepted ANY truthy value (`?emailReady=badvalue` activated it) — inconsistent with the strict `email` validation. | **Fixed in-session** by the same boolean change (`=== true`). Re-verified: `?emailReady=badvalue` and `?emailReady=1` are both stripped to clean `?bucket=freelance`. | no (fixed) |
| MINOR | v5 — a11y blast radius | `web/src/routes/selections.$date.tsx` remove ✕ button | The remove ✕ relies on the browser-default focus outline (no explicit `focus-visible:ring-*` on `btn.danger`); it IS focusable (`opacity-40` at rest, `focus-visible:opacity-100`, `aria-label`, 32px target) and not hover-only. | Optional polish: add an explicit `focus-visible:ring-2 focus-visible:ring-ring/50` for a designed focus indicator. Not blocking — focus is reachable and visible via the global `outline-color: var(--ring)`. | yes (optional) |
| MINOR | v5 — a11y | `web/src/routes/selections.$date.tsx` BucketPanel summary pill ✉ | The summary-pill ✉ glyph is `aria-hidden` with no `sr-only` sibling, unlike the per-row ✉ (which has correct sr-only text). | None required: the adjacent literal text ("N pronti per email" / "N da arricchire") conveys the meaning; the glyph is decorative. | no |
| NIT | v1 — 409 classification | `AddContactsDialog.tsx` | No standalone single-add function; "single add" is `runBatch([id])`. Contract's "two paths" satisfied by one shared path (fatal/skip identical for N=1). | None — not a defect; flagged so reviewers don't expect a second path. | no |
| NIT | v1 — 409 classification | `AddContactsDialog.tsx:59-60` / `client.ts` | Non-`ApiError` throws (network/abort/non-JSON) route to `errore` by design; a 409 with a garbage body defaults to the benign `saltato` ("Errore 409"), never a false `exported`. | None — correct, contract-compliant (a non-409 must not be silently skipped; errors are retryable). | no |
| NIT | v2 — bulk | `AddContactsDialog.tsx:204,298-299` | Double-click reentrancy guard reads `running` from the render closure; real protection is `disabled={!canAct}`. Worst case a synchronous double-click re-fires same ids → they come back `saltato` (no corruption). | Optional: a `useRef` running-flag set synchronously. Not blocking. | no |
| NIT | v2 — bulk | `AddContactsDialog.tsx:289-293` | `saltato`-only post-batch path invalidates `['candidates']` but not `['selection']` (correct — skipped items were already members). | None — edge-of-edge; FLOW concurrency edge still satisfied. | no |
| NIT | v4 — unification | `emailOptions.ts:13` | Canonical export reuses the name `EMAIL_FILTER_OPTIONS` (same as one removed fork) — a grep-by-name could skim past the rename on a stale-branch merge. | Optional rename for hygiene; no divergence exists today (all imports point to the module). | no |
| NIT | v4 — unification | `contacts.index.tsx:219` | Redundant `.map()` copy of `EMAIL_FILTER_OPTIONS` (already satisfies the prop type). | Optional: pass the constant directly. No correctness issue. | no |
| NIT | v5 — a11y | `web/src/routes/runs.tsx:102` | RunCard ✉ glyph has no `aria-hidden`/`sr-only` (out-of-scope page). | Optional follow-up (pre-existing pattern on an out-of-scope page). | yes (optional) |

## What passed

| Concern (verifier) | Evidence |
|--------------------|----------|
| v1 — 409 dual-meaning | `request()` throws `ApiError(res.status, body.error)` on every `!res.ok` (status + message preserved; `instanceof Error` intact). `classifyAddResult` mapping exact; `/esportat/i` verified against the real server constants (`app.ts:96` lock → true, `:105` skip → false). Fatal branch closes dialog + invalidates; single-add (= `runBatch([id])`) inherits it. Duplicate 409 never wired to a blocking ErrorBox. Live curl confirmed 409 "Contatto già presente"; seed restored 20/2. |
| v2 — bulk best-effort | Per-id `Set` independent of pool view; isolation via per-iteration try/catch (no rollback); exported-abort `break`s + not counted as saltato; retry-only-failed runs only `failedIds`; settled ids leave the selection (no double-count); `errori` re-derived per run; post-batch `onAdded` + invalidate `['candidates']`/`['selection']`; all-fail keeps dialog open; rank MAX+1 / no-cap preserved (server `queries.ts`). typecheck clean; seed restored 20/2. |
| v3 — URL persistence | After fix: all six fields persist + survive reload; page-3-stays-page-3; filter change → page 1; `emailReady` excluded from the contacts query key (export-only), does not reset page; export href `email=with` when active; chips/Pulisci correct; default-stripping + strict validation. Verified via agent-browser. |
| v4 — shared components | Exactly ONE email-option definition (`emailOptions.ts`); `EMAIL_OPTIONS` gone; no second `EMAIL_FILTER_OPTIONS` in `selections.$date.tsx`; `FilterBar` has zero router/store coupling; the pool renders the SAME `FilterBar`; tri-state semantics consistent. TD-1 FE read-side fork closed. Repo-wide grep clean. |
| v5 — shadcn blast radius + a11y | typecheck + build exit 0; Tailwind preflight sets `border-width:0` before `*{border-color}` (no spurious borders); `body{bg-slate-100}` + Inter survive in built CSS; `shadcn/tailwind.css` adds only keyframes/variants. Radix Dialog: native FocusScope trap, Escape via DismissableLayer, restore-focus to trigger; `aria-labelledby` correct; "N selezionati" in `aria-live`. Remove ✕ not `opacity-0`; per-row ✉ has sr-only text. Dashboard/Run/Report render. |

## Per-concern verdicts

| Pass | Charter | Verdict | Rationale |
|------|---------|---------|-----------|
| v1 | 409 dual-meaning classification | SHIP | Correct on every attacked axis; only doc/expectation nit + by-design non-409 routing. |
| v2 | Bulk best-effort isolation + retry + tally | SHIP | All charter + acceptance clauses satisfied; only two non-blocking nits. |
| v3 | URL filter/session persistence incl. `page` | DO NOT SHIP → **resolved → SHIP** | Functionally correct, but `emailReady=%221%22` violated the clean-URL invariant + loose validation. Fixed in-session (boolean) and re-verified. |
| v4 | Shared-component unification (TD-1 / Outcome D) | SHIP | Genuine, complete unification; two cosmetic nits. |
| v5 | shadcn blast radius + a11y | SHIP | Gates pass; out-of-scope pages intact; all a11y deliverables met; two non-blocking minors. |

## Resolution (in-session)

The single blocking finding (v3 MAJOR + its MINOR) was remediated by `implement-spec` during this run:

- `web/src/routes/contacts.index.tsx`: `emailReady` retyped from `'1'` to `boolean`; `validateSearch` →
  `s.emailReady === true ? true : undefined`; `setEmailReady(on)` writes `on ? true : undefined`; read as
  `search.emailReady === true`.
- Re-verification (agent-browser, dev server live): active URL = `?...&emailReady=true` (raw param value
  `"true"`, no `%22` quoting); checkbox checked; chip "Export: solo email-ready" present; CSV href
  `email=with`; toggle off removes the param keeping `bucket`+`page`; reload preserves; `?emailReady=badvalue`
  and `?emailReady=1` both stripped. `tsc --noEmit` + `vite build` exit 0.

## Acceptance criteria check (case B)

| Criterion | Met / Unmet / Blocked | Notes |
|-----------|-----------------------|-------|
| A — compact bar + chips + single "Pulisci"; all filters composable; URL persistence incl. `page`; shared pool component | Met | v3 (after fix) + v4. Reload page-3 stays page-3; filter change → page 1; emailReady now clean `emailReady=true`. |
| B — Selezioni breathes, ≥12px, all row info, remove not hover-only, ✉ not color-only, segments+counts, index grid coherent | Met | v5 + T4 evidence. Remove ✕ focusable (opacity-40→focus-visible), per-row ✉ sr-only text; optional explicit focus-ring noted. |
| C — guided Dialog; bulk per-id best-effort; aggiunti/saltati/errori + retry-only-failed; pool cap 30 + ">30" warning; no auto-selection constraints; coherent refresh | Met | v1 + v2. 409 dual-meaning correct (duplicate→saltato, exported→fatal close); isolation + retry + exact tally verified. |
| D — shared reusable components (no fork/duplication); out-of-scope pages functional + acceptable | Met | v4 (single emailOptions, shared FilterBar) + v5 (Dashboard/Run/Report intact, gates green). |
| FLOW error/edge paths (duplicate→skip, exported-while-open→close, all-fail→open, empty/error/Riprova, cap-30, per-id) | Met | Covered across v1/v2/v5; the exported-lock branch is API-probe+code-verified (not click-reachable — exported selections disable the trigger). |

## Human Review Checklist (required — critical impact)

Run before merging/committing the branch:

1. **Gates:** from repo root, `npm --prefix web run typecheck` and `npm --prefix web run build` — both must exit 0.
2. **Clean URL (the fixed finding):** open `/contacts`, tick "solo email-ready" → confirm the URL shows `emailReady=true` (NOT `%221%22`), the chip "Export: solo email-ready" appears, and "Scarica CSV" href contains `email=with`. Reload → state persists. Untick → param disappears, `bucket`/`page` kept.
3. **URL/page no-regression:** open `/contacts?bucket=freelance&page=2`, reload → still page 2; change a filter → page resets to 1; share the URL in a new tab → same state. Hand-type `?emailReady=badvalue` → stripped.
4. **409 dual-meaning (bulk):** open a NON-exported selection `/selections/<date>`, "+ Aggiungi", select ≥2 candidates, confirm "N selezionati" announces; add → "N aggiunti · 0 · 0"; force a duplicate (add one id out-of-band, keep it checked + a fresh one) → "1 aggiunti · 1 saltati (già presente) · 0 errori", the fresh one NOT rolled back. **Restore any test contacts** (`DELETE …/contacts/<id>`) → `GET /api/selections` back to seed.
5. **Dialog a11y:** "+ Aggiungi" → focus lands in the search field; Escape closes and focus returns to "+ Aggiungi".
6. **Selezioni a11y:** the remove ✕ is reachable by keyboard (Tab) without hover; the ✉ marker exposes con/senza-email text.
7. **Out-of-scope regression:** Dashboard `/`, Run `/runs`, Report `/report` render and look acceptable.

## Notes for docs-maintenance

- Durable findings to fold into `tech-debt/lead-engine/selections-filters-ux.md`: the two **optional** a11y nits — explicit `focus-visible` ring on the Selezioni remove ✕ (`selections.$date.tsx`), and the `runs.tsx` RunCard ✉ text-alternative (out-of-scope page). Everything blocking was fixed in-session; nothing else durable.
- Domain pages that should backlink this review: `domains/lead-engine/07-web-ui`, `concepts/stato-filtri-url`, `concepts/presenza-email` (on ingest of the spec).
