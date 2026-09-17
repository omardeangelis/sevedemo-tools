---
domain: prospect-crm
type: review-rubric
scope: spec
spec: crm-foundation
links:
  - "[[specs/prospect-crm/crm-foundation/REPORT]]"
created: 2026-09-16
updated: 2026-09-16
---

# Review Rubric: crm-foundation — pivot a CRM di prospecting LinkedIn

## Change set under review

- **Scope:** spec implementation
- **Target:** working tree non committato su `main` (implementazione di [[specs/prospect-crm/crm-foundation/PLAN|PLAN]])
- **Compared:** `a6f203b` → working tree (incluse le 106 aggiunte non tracciate: `git diff HEAD` da solo le esclude)
- **Files touched:** 159 file tracciati (+2515 / −17113, soprattutto la rimozione del Lead Engine) + 106 file nuovi
  (~15k righe, docs brain incluse), nei domini: `prospect-crm` (nuovo), `lead-engine` (rimosso)
- **Contratto di accettazione:** nessuna `SPEC.md` per scelta del PLAN → story CRM-S0…S8 (PLAN §12), `validation`
  di ogni task (PLAN §13), percorsi happy/error/edge di [[specs/prospect-crm/crm-foundation/FLOW|FLOW]]

## Routing rubric (review-classifier output)

```json
{
  "taskType": "feature",
  "secondaryType": "migration",
  "domainsTouched": ["prospect-crm", "lead-engine"],
  "adversarialVerifiers": {
    "count": 16,
    "passes": [
      { "id": "v1", "charter": "Prospect identity and merge integrity: verify upsertProspect / setProspectIdentity / mergeProspects (src/db/prospects.ts, src/db/identity.ts) and normalizeLinkedinUrl / memberIdOf / profileKeys (src/util/fields.ts) never dedupe on raw URLs, merge atomically in a transaction, move every child row (sources, list_members, activities, analyses, exports.prospect_ids) without loss or UNIQUE-conflict aborts, choose the correct surviving row and status, and that every caller (sync, sourcing, enrich, routes, bulk actions) re-reads ids that can vanish after a merge and handles not-found.", "complexity": "high" },
      { "id": "v2", "charter": "Schema and storage invariants: verify src/db/schema.ts and src/db/index.ts against PLAN section 6 (13 tables, CHECK enums in sync with JOB_KINDS and src/domain/status.ts, partial unique indexes on sources and member_urn with matching ON CONFLICT targets, FK ON DELETE behaviour for company/ICP/list/prospect deletes), that derived states (Inbox, enriched, stale analysis) are never stored as columns, that init is idempotent on an existing data/crm.db, and that the legacy data/sevedemo.db is never opened, read or migrated.", "complexity": "high" },
      { "id": "v3", "charter": "Contact-state invariants: verify every status-change path (single, bulk, export markContacted, merge) is user-initiated and writes exactly one status_change activity, that no job or AI result assigns lists or statuses beyond the list explicitly chosen at sourcing launch, and that export/analysis/enrichment/touchpoint/note activities are written and deleted per the domain contract (src/db/activities.ts, src/db/lists.ts, src/server/routes/prospects.ts, src/server/routes/lists.ts).", "complexity": "medium" },
      { "id": "v4", "charter": "Job controller lifecycle and concurrency: verify src/server/jobs.ts, src/server/job-entry.ts, src/db/jobs.ts, src/jobs/handlers.ts and src/server/routes/jobs.ts enforce a single running job (live-pid guard, 409 job_running also on retry, the non-transactional check-then-insert), mark dead or crashed children failed with attributed actor:/config:/process: errors, always write a final state and result, retry only failed jobs with identical params, and avoid SQLITE_BUSY or lost writes between server and child.", "complexity": "high" },
      { "id": "v5", "charter": "Paid-spend control: verify no Apify or Anthropic call can start without an explicit, preview-backed launch: blockers enforced server-side on start (400 blocked) for all four job kinds and for the synchronous single-prospect analyze/enrich endpoints, est_cost_usd honest or null, caps (REACTIONS_PER_POST, maxItems, >500 selection), cooldown/recency/freshness and force semantics, retries and partial failures never re-paying already-fetched data, JobPreviewDialog disabling Avvia on blockers or stale preview, and that tests and scripts/e2e-server.ts cannot reach real providers.", "complexity": "high" },
      { "id": "v6", "charter": "Apify adapter correctness (excluding cost): verify actor IDs and input builders live only in src/apify/actors.ts and match the PLAN section 7 input schemas, mappers in src/acquisition/mappers/ and src/enrich/profile-detail.ts read output tolerantly via field() and always pass memberUrn through, per-item failures (post, company, profile) are isolated, and job outcomes in src/jobs/{sync-interactions,source-company,enrich}.ts honestly distinguish zero results, warnings and attributed errors.", "complexity": "medium" },
      { "id": "v7", "charter": "AI analysis correctness (excluding cost and prompt injection): verify src/analysis/{analyze,prompt,schema}.ts, src/jobs/analyze.ts, src/db/analyses.ts and src/server/routes/analyze.ts use structured outputs with ANALYSIS_MODEL and the configured max_tokens, validate output with zod, record refusal / max_tokens / timeout / invalid JSON as analysis activities without crashing the job, require enrichment or a manual About, compute input_hash so staleness is correct, and persist fit and row states (alto/medio/basso, rifiutata/errore/non_arricchibile) consistently with FLOW E.", "complexity": "medium" },
      { "id": "v8", "charter": "Untrusted-input injection sinks: trace third-party LinkedIn data and request input into (a) SQL built with template strings for dynamic columns, filters and ORDER BY in src/db/*.ts, (b) CSV cells in src/exports/list-export.ts and src/util/csv.ts (formula injection, quoting, newlines), (c) LLM prompts in src/analysis/prompt.ts (prompt-injection delimiting), (d) frontend rendering of scraped text and URLs (href schemes, raw HTML); verify each sink is parameterized, allow-listed or neutralized.", "complexity": "high" },
      { "id": "v9", "charter": "Secrets confidentiality: verify APIFY_TOKEN and ANTHROPIC_API_KEY loaded by src/config.ts never appear in logs, jobs params/result/error, activities meta, API responses (including settings readiness), error bodies or CSV; that env propagation to children in src/server/jobs.ts is acceptable; and that .env.example, .gitignore, tests/setup.ts and scripts/e2e-server.ts keep real keys out of the repo, tests and e2e.", "complexity": "high" },
      { "id": "v10", "charter": "Third-party PII exposure under the no-auth design: verify the unauthenticated Hono API and SPA fallback in src/server/index.ts and src/server/app.ts are reachable only locally (bind address, CORS, Vite proxy in web/vite.config.ts), that data/ and exports/ are gitignored, that CSV export emits only the intended prospects and columns, and that committed fixtures under tests/fixtures/ contain no real personal data.", "complexity": "high" },
      { "id": "v11", "charter": "Real-database protection from non-product paths: verify the scripts/e2e-server.ts seed/reset cannot target data/ through any DB_PATH form (relative, symlink, case, env override, default fallback), that tests/setup.ts and tests/purge-guard.test.ts give each vitest process an isolated temp DB, and that DB path resolution in src/config.ts cannot silently fall back to data/crm.db from tests or the e2e server.", "complexity": "high" },
      { "id": "v12", "charter": "HTTP wire-contract conformance: verify every router in src/server/routes/ follows the AGENTS.md API conventions for shapes (readJson strict zod v4 to 400 with issues, idParam 404, Italian {error, code?} bodies, snake_case columns with parsed JSON, {items} plus pagination, 201 create, {ok: true} delete, 202 {job}) and that web/src/api/client.ts and web/src/api/types.ts match the real server paths and response shapes.", "complexity": "medium" },
      { "id": "v13", "charter": "Frontend acquisition and job UX vs FLOW.md: verify onboarding, settings (profile, company, posts, recent jobs), ICP and company pages, SyncDialog, SourceCompanyDialog, JobBanner and web/src/lib/jobs.ts implement FLOW happy/error/edge paths for sync, sourcing and job outcomes (running banner, failed plus Riprova, partial failure, zero results, warnings, two tabs), with Italian copy and FLOW accessibility notes; check against existing TD-1..TD-22 instead of re-reporting them.", "complexity": "medium" },
      { "id": "v14", "charter": "Frontend triage and contact UX vs FLOW.md: verify Inbox, lists index/detail, prospect detail, ProspectTable, BulkBar, AddToListDialog, ListPicker, StatusSelect, Timeline, TouchpointForm, AnalysisCard and ExportDialog implement FLOW paths (filters in the URL, bulk actions and >500 selection cap, archived lists, discard/restore, merged or deleted prospect not-found, refusal and not-enrichable states, empty exports), with Italian copy and keyboard/focus accessibility; check against existing TD entries.", "complexity": "medium" },
      { "id": "v15", "charter": "Build, tooling and legacy-purge integrity: run the four AGENTS.md gates (npm run typecheck incl. scripts/, npm test, npm --prefix web run build, npm --prefix web run typecheck) and verify package.json scripts, pnpm-lock dependency changes (Anthropic SDK and zod bumps, removed deps), tsconfig.tests.json and web/vite.config.ts are coherent, that no source/test/script/README/AGENTS reference to deleted Lead Engine modules or LINKEDIN_LI_AT remains, and that web/src/routeTree.gen.ts stays generated and untracked.", "complexity": "medium" },
      { "id": "v16", "charter": "Spec acceptance traceability: map CRM-S0..S8, every PLAN section 13 task validation and the FLOW.md error/edge paths to concrete code plus test or T18 smoke evidence; flag stories with no evidence, fake deps in src/jobs/fake-deps.ts whose shapes diverge from real deps (which would make the smoke evidence meaningless), IMPLEMENTATION-NOTES deviations (max_tokens 16000, uniform 409, from-url without listId, analyze preview path) or MINOR tech-debt entries that actually break an acceptance criterion, and brain-reset consistency (contract, index, spec map).", "complexity": "medium" }
    ]
  },
  "taskComplexity": "high",
  "reviewImpact": "critical",
  "humanInLoop": true,
  "nextStep": "Run 16 independent clean-context adversarial-verifier passes (high -> strongest model/Opus, medium -> balanced model). Build the change as working tree vs a6f203b including the 106 untracked files (git diff HEAD alone leaves them out). Give each pass only its scoped files plus the matching PLAN/FLOW/contract excerpt, with paths relative to /Users/omardeangelis/Desktop/imparare-cose/sevedemo-tools. Only v15 runs the gates; all other passes stay read-only, because concurrent builds made vitest flaky in W5. Any pass that starts the e2e server or agent-browser must use its own UI_PORT, never touch data/, never call real Apify/Anthropic, and stop processes by PID. Aggregate into brain/specs/prospect-crm/crm-foundation/RUBRIC.md and REPORT.md with a mandatory human checklist. Do not commit or ship before the human completes it."
}
```

## Classifier rationale

L'impatto è **critical** perché il cambiamento tocca sei delle sette superfici sensibili generiche: spesa su API a
pagamento (Apify, Anthropic), PII di terzi, sink di injection (SQL con template string, CSV, prompt LLM), segreti,
schema/migrazione e configurazione di build; la settima (autenticazione) manca per scelta ed è riformulata come
"l'API senza auth è raggiungibile solo in locale?" (v10). Il contract del dominio impone invarianti ad alto rischio
isolati in pass dedicati: merge automatico dei duplicati che cancella righe e sposta i figli (v1), un solo job alla
volta con guardia sul pid (v4), preview di costo prima di ogni chiamata a pagamento e nessuna doppia spesa (v5).
`data/crm.db` contiene dati reali e il server e2e azzera il proprio DB, da cui la verifica dedicata del guard (v11).
L'ampiezza (~15k righe nuove, ~17k rimosse, ~9k di frontend da confrontare con FLOW) giustifica 16 pass a concern
singolo, con le sovrapposizioni probabili tagliate esplicitamente (retry: meccanica v4 / costo v5; analisi:
correttezza v7 / injection v8; status code: guardie v4-v5 / forma v12). Le 22 voci MINOR del tech-debt sono note:
v16 verifica solo se qualcuna rompe davvero un criterio di accettazione.

## Overrides applied

Nessuno. Controlli di validità: 16 pass con charter singoli e non sovrapposti; `reviewImpact: critical` ⇒
`humanInLoop: true`; le superfici sensibili (spesa, segreti, input non fidato, PII, migrazione, build) sono tutte
coperte e hanno prodotto l'escalation; il numero di pass è giustificato dall'ampiezza del cambiamento.

## Verification plan (derived)

| Pass | Charter (sintesi) | Complexity | Model tier |
|------|-------------------|------------|------------|
| v1 | Identità dei prospect e integrità del merge | high | strongest (Opus-class, ereditato) |
| v2 | Invarianti di schema e storage | high | strongest |
| v3 | Invarianti degli stati di contatto e delle attività | medium | balanced (Sonnet-class) |
| v4 | Ciclo di vita e concorrenza del controller dei job | high | strongest |
| v5 | Controllo della spesa a pagamento | high | strongest |
| v6 | Correttezza degli adapter Apify (senza costi) | medium | balanced |
| v7 | Correttezza dell'analisi AI (senza costi né injection) | medium | balanced |
| v8 | Sink di injection da input non fidato | high | strongest |
| v9 | Riservatezza dei segreti | high | strongest |
| v10 | Esposizione di PII di terzi senza auth | high | strongest |
| v11 | Protezione del DB reale dai percorsi non di prodotto | high | strongest |
| v12 | Conformità del contratto HTTP (server ↔ client web) | medium | balanced |
| v13 | UX FE di acquisizione e job vs FLOW | medium | balanced |
| v14 | UX FE di triage e contatto vs FLOW | medium | balanced |
| v15 | Integrità di build, tooling e purge del legacy (unico pass che esegue i gate) | medium | balanced |
| v16 | Tracciabilità dell'accettazione della spec | medium | balanced |
