---
domain: lead-engine
type: plan
spec: "[[specs/lead-engine/progressive-enrichment/SPEC]]"
links:
  - "[[specs/lead-engine/progressive-enrichment/SPEC]]"
created: 2026-06-14
updated: 2026-06-14
---

# PLAN — Enrichment progressivo + Selezione figlia del Run + remodel degli stati

> Piano di esecuzione per [[specs/lead-engine/progressive-enrichment/SPEC]].
> **Modalità consigliata:** `sequential`. Nessun codice scritto in fase di plan.

---

## Situation

Il Lead Engine (`runDaily`) estrae → arricchisce in batch (`dev_fusion/linkedin-profile-scraper`) → score → seleziona 20+20 → bozza email → export. L'email è recuperata solo **best-effort**: molti contatti scored finiscono in Selezione **senza email**, non inviabili. La UI segmenta "✉ pronti" / "da arricchire", ma "da arricchire" è un vicolo cieco (solo edit manuale). Il legame **Run ↔ Selezione** è implicito (`daily_selection` agganciata solo alla `date`; `runs` ha una riga per strategia per data, nessun id d'esecuzione).

## Issue

1. Il segmento "da arricchire" non ha azione: serve enrichment **on-demand** via `apimaestro/linkedin-profile-detail` che, quando recupera un'email prima assente, genera la bozza e fa passare il contatto a "pronto".
2. Manca l'identità di Run: la Selezione deve essere **figlia di un Run** (`run_id` reale), con provenienza e stati pronti/da-arricchire visibili.
3. **Il modello degli stati è sbagliato** (emerso in plan): `contacts.status` mescola *stadio del dato* (new/enriched/scored) e *ciclo cold-email* (proposto/validato/inviato). Sintomo: `runDaily` mette i selezionati a `selected` e subito li sovrascrive a `exported` (`run.ts:188,205`); `addToSelection`/`removeFromSelection` non sincronizzano lo status → un contatto rimosso da una Selezione resta `selected` **orfano**. → **remodel** (vedi sotto).

## Solution shape — il remodel degli stati (cuore del piano)

Separiamo nettamente le due dimensioni che oggi sono fuse in `status`:

- **`contacts.status` = solo stadio del DATO** (intrinseco, monotòno):
  `new → enriched → scored` + `discarded` (scoring `bucket='scarta'`) + `rejected_geo` (tombstone geo).
  **Niente più `selected`/`exported` sul contatto.**
- **La Selezione (`daily_selection`) ha un ciclo proprio:** `in_review` (prodotta dal Run / mentre la si edita e arricchisce) → `exported` (validata e committata dall'operatore). Stato su **colonna `daily_selection.state`** (denormalizzata: tutte le righe di una selezione condividono lo stato).
- **"Proposto" e "già contattato" = fatti di _membership_, non status:**
  - Eleggibilità per un nuovo Run = `status='scored'` **AND `id NOT IN (SELECT contact_id FROM daily_selection)`**. Un contatto proposto è escluso dai run futuri da solo; **rimuoverlo** da una Selezione lo rende di nuovo eleggibile **automaticamente** → *il bug orfano sparisce per costruzione, senza logica di sync.*
  - "Max una email" = non riproporre chi è in una Selezione **`exported`** (membro di una selezione committata).
- **"pronto / da arricchire" = DERIVATO** (non uno status): `pronto` = `email` presente (predicato canonico esistente, [[specs/lead-engine/email-segmentation-filters/SPEC]]); `da arricchire` = senza email, ulteriormente derivabile in *mai tentato* / *tentato senza esito* (via `last_enrichment_attempt_at`) e *fresh* / *stale*. Caso raro "email ma bozza mancante" → flag UI "bozza da rigenerare", non un segmento nuovo.

Risultato: *"una Selezione è l'export validato di un Run"* è **esattamente** il modello dei dati. Il contatto resta `scored`; è la Selezione a passare `in_review → exported`.

### Filoni additivi a valle del remodel

- **Run identity (`run_id` reale):** generato una volta per esecuzione di `runDaily`, su righe `runs` **e** `daily_selection`. Pagina Run raggruppata per esecuzione, con stato selezione + conteggi pronti/da-arricchire + link.
- **Enrichment progressivo:** actor `apimaestro/linkedin-profile-detail` (on-demand), **mapper annidato** dedicato (output `basic_info.*`, non piatto), email da `basic_info.email` (+ fallback regex su `about`). Scrittura **status-preserving** (`applyProgressiveEnrichment`) che fa refresh COALESCE e timbra `last_enrichment_attempt_at`/`last_enrichment_actor` senza toccare lo status. Orchestrazione `enrichSelectionEmails` che bersaglia i membri di una Selezione **`in_review`** senza email, freschness-eligible; al recupero email genera la bozza (`draftMany`). Job asincrono riusando `ui_job` (chiave `ui_job:enrichment`), esito aggregato nel record di stato.
- **Migrazione idempotente:** nessun framework esiste → helper `ensureColumn` (`PRAGMA table_info`) + remap one-shot dei dati legacy.

## Assumptions

- **A1 — stato selezione su colonna `daily_selection.state`** (`in_review`/`exported`), default `in_review`. *(scelta utente)*
- **A2 — `pronto` = email presente** (predicato canonico); "email senza bozza" = flag UI, non segmento. *(scelta utente)*
- **A3 — `discarded`** assegnato a scoring-time quando `bucket='scarta'`. *(scelta utente)*
- **A4 — target enrichment** = membri di Selezione `in_review`, email vuota, tentativo stale per `config.freshnessDays`. Vale per bulk **e** singolo (nessun force).
- **A5 — `run_id` formato `YYYY-MM-DD-N`** (N progressivo del giorno), opaco per i test. Generato a inizio `runDaily`.
- **A6 — email da `about`:** fallback regex su `basic_info.about` quando `basic_info.email` è vuoto *(default consigliato — vetabile)*.
- **A7 — dati legacy:** migrati best-effort (vedi T1); `erase` resta la via pulita (fase test). *([[lead-engine-testing]])*
- **A8 — niente tracker esterno:** backlog in `brain/` (vedi *Backlog sync*).

## Findings (codebase, file:line)

- `src/db/index.ts:6-85` — `SCHEMA` con `CREATE TABLE IF NOT EXISTS`; `db.exec(SCHEMA)` al load. **Nessun** `ALTER`/migrazione (grep confermato). `nowIso()`/`today()`.
- `src/db/contacts.ts` — `updateScore` (`:132`) imposta sempre `status='scored'` (→ aggiungere ramo `discarded`). `updateEnrichment` (`:96`) forza `status='enriched'` (non riusabile per il progressivo → `applyProgressiveEnrichment`). `isFresh` (`:76`) su `last_evaluated_at`. `markRejectedGeo` (`:167`), `setStatus`, `updateEmail`, `getByIds`.
- `src/pipeline/select.ts` — `selectBucket(bucket,target,minFit)`: `WHERE bucket=? AND status='scored' AND fit_score>=?` + cap per settore. → aggiungere `AND id NOT IN (SELECT contact_id FROM daily_selection)`.
- `src/db/runs.ts:13-44` — `logRun(RunLog)`, `saveSelection(date, rows)` (DELETE+INSERT per data). → estendere con `run_id` + `state`.
- `src/pipeline/run.ts:162-220` — `runDaily`: `saveSelection` (`:187`) → `setStatus('selected')` (`:188`, **da rimuovere**) → `draftMany`/`updateEmail` → `exportContacts` (`:204`) → `setStatus('exported')` (`:205`, **da rimuovere**) → `logRun` ×strategia. `runStrategy` (`:223`).
- `src/enrich/profile.ts:10-35` — `enrichProfiles(urls)` con mapping **piatto** via `field()`. *Non riusabile per apimaestro* (output annidato) → mapper dedicato in `profile-detail.ts`.
- `src/apify/actors.ts:10-45` — `ACTORS` + builder input ("unico punto da adattare").
- `src/apify/client.ts` — `runActor(actorId, input)` blocking → `{ items, runId, datasetId }`.
- `src/email/draft.ts` — `draftMany(rows)` guard `hasEmail`; riusabile sul sottoinsieme con email recuperata.
- `src/server/jobs.ts:7-133` — `JOB_KV_KEY='ui_job:daily'`, `StartOptions{command?,args?}` (override test), `getJobStatus()`, `startDailyRun`, `writeTerminalStatus`. `run-daily-job.ts` wrapper figlio.
- `src/server/app.ts:32-200` — Hono; `/api/runs` (`:40`), `/api/selections/:date` (`:70`, ritorna `{date,items}`), add/remove/candidates/export. `patchSchema.status` enum `new|enriched|scored|selected|exported` (`:178`) → **aggiornare** a `new|enriched|scored|discarded|rejected_geo`.
- `src/server/queries.ts` — `listRuns` (`:15`), `getSelectionItems(date)` (`:45`, `SELECT c.*` → nuove colonne fluiscono), `listCandidates` (`:89`, `status IN ('scored','selected','exported')` → **rivedere**), `getStats` (`:224`).
- `web/`: `routes/runs.tsx` (group per `run_date`), `routes/selections.$date.tsx` (partizione `isEmailReady`), `api/client.ts` + `api/types.ts`, `lib/pipeline.ts` (`usePipelineStatus`), `components/ui.tsx` (`StatusBadge`).
- Test: `tests/setup.ts` (DB temp + chiavi dummy), `tests/jobs.test.ts` (override `command/args` + `vi.waitFor`), `tests/email-draft-guard.test.ts` (mock Anthropic).

## Research — output dell'actor `apimaestro/linkedin-profile-detail`

Output **annidato** (campione reale fornito). Mapping `Enrichment`:

| `Enrichment` | Sorgente |
|---|---|
| `email` | `basic_info.email` (fallback: regex email su `basic_info.about`) |
| `fullName` | `basic_info.fullname` |
| `headline` | `basic_info.headline` |
| `about` | `basic_info.about` (truncate 2000) |
| `location` | `basic_info.location.full` |
| `company` | `basic_info.current_company` |
| `phone` | assente in apimaestro → invariato (COALESCE) |
| `raw` | `{ source: it, experience, education, certifications }` |

Note: actor **single-profile** (un oggetto per chiamata) → `enrichProfileDetails(urls)` itera per URL con concorrenza limitata (il path batch-array è ottimizzazione gated su R1). Input builder = unico punto d'adattamento (R1). Nessuna libreria nuova.

---

## Execution mode

**Consigliata `sequential`.** Grafo quasi lineare (schema → modello → API → UI) con file caldi condivisi (`app.ts`, `run.ts`, `contacts.ts`, `web/src/api/*`). Confermare e annotare in `IMPLEMENTATION-NOTES.md` prima di scrivere codice.

## Dependency graph

```
T1 schema/migrazione ─┬─> T2 contact write-paths ─┬─> T3 runDaily+select (run_id, membership, no selected/exported)
                      │                            └─> T5 enrich-selection
T4 actor+enricher ─────────────────────────────────┘            │
                                                                 v
                              T5 ─> T6 enrich-job ─┐
                              T3 ──────────────────┴─> T7 API layer ─> T8 Run page ─> T9 Selection page
```

| Wave | Tasks |
|------|-------|
| W1 | T1, T4 |
| W2 | T2 |
| W3 | T3, T5 |
| W4 | T6 |
| W5 | T7 |
| W6 | T8 |
| W7 | T9 |

---

## Tasks

### T1 — Schema + migrazione idempotente (colonne + remap dati legacy)
- **status:** done · **depends_on:** [] · **location:** `src/db/index.ts` · **review_mode:** cli · **tdd_target:** true · **owning_story:** S-SCHEMA
- **log:** `ensureColumn`/`migrate` esportati da `src/db/index.ts`; SCHEMA CREATE TABLE invariati, colonne nuove tutte via `migrate()` (unica fonte). Remap legacy guardato da `addedState` + naturalmente idempotente. Test `tests/migration.test.ts` (3 casi: colonne+indici+default, remap legacy, idempotenza). Suite 56/56, typecheck verde.
- **description:** `ensureColumn(table,column,ddl)` (guard `PRAGMA table_info`), eseguito dopo `db.exec(SCHEMA)`. Aggiungere: `runs.run_id TEXT`, `daily_selection.run_id TEXT`, `daily_selection.state TEXT NOT NULL DEFAULT 'in_review'`, `contacts.last_enrichment_attempt_at TEXT`, `contacts.last_enrichment_actor TEXT`. Indici `idx_runs_run_id`, `idx_daily_selection_run_id`, `idx_daily_selection_state`. **Remap one-shot legacy** (guardato dalla prima comparsa di `state`): righe `daily_selection` di contatti `status='exported'` → `state='exported'`; poi `UPDATE contacts SET status='scored' WHERE status IN ('selected','exported')`. Idempotente; nota: `erase` è la via pulita (A7).
- **files (edit):** `src/db/index.ts`
- **validation:** vitest — colonne+indici presenti su DB fresco; su DB legacy simulato (senza colonne, con contatti `selected`/`exported`) la migrazione aggiunge le colonne, marca le selezioni legacy `exported` e rimappa gli status a `scored`; doppia esecuzione no-op.

### T2 — Stati-dato del contatto + write-path enrichment progressivo
- **status:** done · **depends_on:** [T1] · **location:** `src/db/contacts.ts` · **review_mode:** cli · **tdd_target:** true · **owning_story:** S-STATE
- **log:** `updateScore` → `discarded` su `bucket='scarta'`; `applyProgressiveEnrichment` (status-preserving, stamp sempre, `''`→no-clobber via `clean()`); `isEnrichmentFresh`. `ContactRow` += `last_enrichment_attempt_at`/`last_enrichment_actor` → fix factory in `email-draft-guard.test.ts` e `italy-geo-gate.test.ts`. Test `tests/contacts-progressive.test.ts` (4 casi). Suite 60/60, typecheck verde.
- **description:**
  - `updateScore`: se `bucket==='scarta'` → `status='discarded'`, altrimenti `'scored'` (stadio-dato). Resta lo stamp `last_evaluated_at`.
  - `applyProgressiveEnrichment(id, e, actor)`: refresh COALESCE (`full_name/headline/about/location/email/phone/company/raw_json`) **senza** toccare `status`; timbra **sempre** `last_enrichment_attempt_at=nowIso()` + `last_enrichment_actor=actor` (anche su miss).
  - `isEnrichmentFresh(id, freshnessDays)`: come `isFresh` ma su `last_enrichment_attempt_at`.
- **files (edit):** `src/db/contacts.ts`
- **validation:** vitest — `updateScore` con `bucket='scarta'` → `discarded`, altrimenti `scored`; `applyProgressiveEnrichment` preserva lo `status` (es. `scored`→`scored`), setta `email` solo se nuovo non-vuoto, timbra sempre attempt+actor; `isEnrichmentFresh` true entro finestra, false se mai tentato/stale.

### T3 — `runDaily`: `run_id`, eleggibilità membership, fine `selected`/`exported`
- **status:** done · **depends_on:** [T1, T2] · **location:** `src/pipeline/select.ts`, `src/db/runs.ts`, `src/pipeline/run.ts` · **review_mode:** cli · **tdd_target:** true · **owning_story:** S-RUNID
- **log:** `selectBucket` + `AND id NOT IN (SELECT contact_id FROM daily_selection)`; `newRunId(date)`, `RunLog.runId`, `logRun`/`saveSelection(date,rows,runId)` scrivono `run_id`(+`state='in_review'`); `runDaily`/`runStrategy` generano `runId`, rimossi i due `setStatus('selected'/'exported')` (+ import `setStatus`). CSV su disco invariato. Test `tests/run-id-selection.test.ts` (3 casi). Catena interna `runDaily` non testata (mock Apify/Claude) → verificata per ispezione+typecheck. Suite 63/63, typecheck verde.
- **description:**
  - `select.ts`: `selectBucket` aggiunge `AND c.id NOT IN (SELECT contact_id FROM daily_selection)` (eleggibilità = scored e non già proposto da nessuna parte).
  - `runs.ts`: `newRunId(date)` → `\`${date}-${N+1}\`` (`N=COUNT(DISTINCT run_id) WHERE run_date=date AND run_id IS NOT NULL`); `RunLog.runId`; `logRun` scrive `run_id`; `saveSelection(date, rows, runId)` scrive `run_id` + `state='in_review'` su ogni riga.
  - `run.ts`: `runId=newRunId(date)` a inizio `runDaily`, passato a `saveSelection` + `logRun`. **Rimuovere** `setStatus('selected')` (`:188`) e `setStatus('exported')` (`:205`) — i contatti restano `scored`; il CSV su disco resta. `runStrategy`: `run_id` proprio.
- **files (edit):** `src/pipeline/select.ts`, `src/db/runs.ts`, `src/pipeline/run.ts`
- **validation:** vitest — `selectBucket` esclude contatti già in `daily_selection`; `saveSelection` persiste `run_id`+`state='in_review'`; `logRun` persiste `run_id`; `newRunId` incrementale/unico. *(catena interna di `runDaily` non eseguita nei test — verificata per ispezione+typecheck.)*

### T4 — Actor apimaestro + enricher annidato (+ fallback email da about)
- **status:** done · **depends_on:** [] · **location:** `src/apify/actors.ts`, `src/enrich/profile-detail.ts` · **review_mode:** cli · **tdd_target:** true · **owning_story:** S-ENRICH
- **log:** `ACTORS.profileDetail` + `profileDetailInput` (R1, multi-chiave best-effort). `src/enrich/profile-detail.ts`: `mapProfileDetailItem` (annidato `basic_info.*`, email+fallback `firstEmailIn(about)`, ritorna `{url,enrichment}`), `enrichProfileDetails(urls)` per-URL `pLimit(3)`, mappa per url normalizzato, item url-less omessi. Test `tests/profile-detail.test.ts` (5 casi, `runActor` mockato). Suite 68/68, typecheck verde.
- **description:** `actors.ts`: `profileDetail: 'apimaestro/linkedin-profile-detail'` + `profileDetailInput(urls)` (best-effort, unico punto d'adattamento — R1). `profile-detail.ts`: `enrichProfileDetails(urls): Promise<Map<string,Enrichment>>` — chiamata per URL (single-profile) a concorrenza limitata; `mapProfileDetailItem(it)` legge `basic_info.*` / `basic_info.location.full`; `email = basic_info.email || firstEmailIn(basic_info.about)` (A6); chiave = `normalizeLinkedinUrl(basic_info.profile_url)`.
- **files (edit):** `src/apify/actors.ts` · **(create):** `src/enrich/profile-detail.ts`
- **validation:** vitest (mock `runActor`) — `mapProfileDetailItem` estrae email/about/location/company dall'output annidato campione; fallback regex su `about` quando `basic_info.email` vuoto; `Map` chiavata per url normalizzato; item senza url omessi.

### T5 — Orchestrazione `enrichSelectionEmails`
- **status:** done · **depends_on:** [T2, T4] · **location:** `src/pipeline/enrich-selection.ts` · **review_mode:** cli · **tdd_target:** true · **owning_story:** S-ENRICH
- **log:** `enrichSelectionEmails({date,bucket?,contactId?})`: query membri `in_review` senza email; freshness-gate (`skippedFresh`, niente chiamata se 0 target); `applyProgressiveEnrichment` per target (timbra i miss); recuperati→`draftMany`+`updateEmail`. `EnrichSummary {eligible,attempted,emailsRecovered,draftsGenerated,skippedFresh}`. Test `tests/enrich-selection.test.ts` (3 casi, mock `enrichProfileDetails`+SDK). Suite 71/71, typecheck verde.
- **description:** `enrichSelectionEmails({date,bucket?,contactId?}): Promise<EnrichSummary>`: target = membri della `daily_selection` di `date` con `state='in_review'` (filtri `bucket`/`contactId`), `email` vuota, `isEnrichmentFresh==false`. `enrichProfileDetails(urls)`; per **ogni** target `applyProgressiveEnrichment(id, map.get(url) ?? {}, ACTORS.profileDetail)` (timbra anche i miss); i target che ora hanno email → `draftMany(subset)`+`updateEmail`. Ritorna `{eligible, attempted, emailsRecovered, draftsGenerated, skippedFresh}`.
- **files (create):** `src/pipeline/enrich-selection.ts`
- **validation:** vitest (mock `enrichProfileDetails`+Anthropic) — email recuperata → bozza+summary; contatto fresh → `skippedFresh`, intoccato; contatto che resta senza email → `attempted` ma nessuna bozza, attempt timbrato; `status` preservato; target solo da selezioni `in_review`.

### T6 — Job enrichment (factory `ui_job`) + wrapper
- **status:** done · **depends_on:** [T5] · **location:** `src/server/jobs.ts`, `src/server/run-enrichment-job.ts` · **review_mode:** cli · **tdd_target:** true · **owning_story:** S-JOB
- **log:** `createJobController(kvKey)` (factory); export daily invariati come wrapper (zero impatto su app.ts/run-daily-job.ts/jobs.test.ts). `JobStatus += target?,result?`. Controller enrichment (`ui_job:enrichment`): `startEnrichmentRun(params,opts?)` spawna `run-enrichment-job.ts` argv `[date,bucket,contactId]`, rifiuta se daily **o** enrichment running (`alsoBlockedBy`). Wrapper `run-enrichment-job.ts`. Test `tests/enrichment-job.test.ts` (3 casi) + `jobs.test.ts` verde. Suite 74/74, typecheck verde.
- **description:** Refactor `jobs.ts` → `createJobController(kvKey)`; mantenere invariati gli export attuali come wrapper sul controller `daily` (zero impatto su `app.ts`/`run-daily-job.ts`/test). `JobStatus += result?: EnrichSummary, target?`. Controller `enrichment` (`ui_job:enrichment`): `startEnrichmentRun(params, opts?)` spawna `run-enrichment-job.ts` argv `[date,bucket?,contactId?]`; rifiuta se daily o enrichment `running`. Wrapper: parse argv → `enrichSelectionEmails` → `writeTerminalStatus({succeeded, result})`.
- **files (edit):** `src/server/jobs.ts` · **(create):** `src/server/run-enrichment-job.ts`
- **validation:** vitest (pattern `jobs.test.ts`) — idle→running→succeeded con `result`; rifiuto concorrente; test daily restano verdi (backward-compat).

### T7 — API layer (queries + endpoint)
- **status:** done · **depends_on:** [T3, T6] · **location:** `src/server/app.ts`, `src/server/queries.ts` · **review_mode:** cli · **tdd_target:** true · **owning_story:** S-API
- **log:** `queries.ts`: `listRunExecutions` (group `run_id`, `GROUP_CONCAT` strategie, selezione+conteggi `ready/toEnrich`), `getSelectionMeta`, `setSelectionExported`, `listCandidates`→`status='scored' AND NOT IN (any selection)`, `getStats += freshnessDays, selectionsByState`. `app.ts`: `/api/runs`→executions, `/api/selections/:date`→`selectionPayload {date,run_id,state,items}`, `POST .../enrich` (202/404/409), `GET /api/enrichment/status`, `POST .../export`, add/remove 409 se exported, `patchSchema.status` enum nuovo, `AppOptions.enrichmentJob`. Test `tests/api-progressive.test.ts` (7 casi); `api.test.ts` verde. Suite 81/81, typecheck verde.
- **description:** (tutti gli edit server in un task per evitare contesa su `app.ts`)
  - `queries.ts`: `listRunExecutions()` (group `run_id`, legacy `NULL`→`date:<run_date>`; strategie+items; stato selezione + conteggi `ready/toEnrich/total` con `daily_selection.run_id=run_id`). `getStats() += freshnessDays`, `byStatus` nuovi valori, conteggi stato-selezione. `listCandidates` → `status='scored' AND id NOT IN (SELECT contact_id FROM daily_selection)`. `setSelectionExported(date)` (tutte le righe → `state='exported'`). `getSelectionMeta(date)` → `{run_id, state}`. Guard: `addToSelection`/`removeFromSelection` falliscono se `state='exported'`.
  - `app.ts`: `/api/runs` → `listRunExecutions`. `/api/selections/:date` → `{date, run_id, state, items}`. `POST /api/selections/:date/enrich` (202; 409 se job running; valida `contactId` ∈ selezione e `state='in_review'`). `GET /api/enrichment/status`. `POST /api/selections/:date/export` → `setSelectionExported` + selezione aggiornata. `patchSchema.status` → `new|enriched|scored|discarded|rejected_geo`. add/remove → 409 se `exported`.
- **files (edit):** `src/server/app.ts`, `src/server/queries.ts`
- **validation:** vitest (`app.request()`) — `/api/runs` per-esecuzione con stato+conteggi; `/api/selections/:date` include `run_id`+`state`; `/api/stats` include `freshnessDays`; `POST .../enrich` 202/409; `POST .../export` porta `state='exported'`; add/remove su selezione `exported` → 409; `listCandidates` esclude i già-membri.

### T8 — FE Pagina Run (per-esecuzione + stato selezione)
- **status:** done · **depends_on:** [T7] · **location:** `web/src/routes/runs.tsx`, `web/src/api/client.ts`, `web/src/api/types.ts` · **review_mode:** browser · **tdd_target:** false · **assigned_skills:** [agent-browser] · **owning_story:** S-UI-RUN
- **log:** `types`: `RunExecution`/`RunExecutionSelection`, `Selection += run_id,state`, `Contact += last_enrichment_*`, `Stats += freshnessDays,selectionsByState`, status set nuovo. `client.runs()`→`RunExecution[]`. `runs.tsx` riscritto: card per esecuzione (run_id/legacy), strategie badge, `SelectionStateBadge`, conteggi pronti/da-arricchire, link. `index.tsx` recent-runs adattato. agent-browser: card per esecuzione con stato+conteggi+link OK. typecheck+build web verdi.
- **description:** `types`/`client`: `RunExecution`, `api.runs()`. `runs.tsx`: raggruppa per `run_id` (fallback data sui legacy), mostra strategie+items, **stato Selezione** (`in_review`/`exported`), conteggi pronti/da-arricchire e link "Apri selezione".
- **validation:** agent-browser — con DB seed la pagina mostra un blocco per esecuzione con stato selezione + conteggi corretti + link.

### T9 — FE Pagina Selezione (provenienza, stato, enrich, derivati, Esporta)
- **status:** done · **depends_on:** [T7, T8] · **location:** `web/src/routes/selections.$date.tsx`, `web/src/api/client.ts`, `web/src/api/types.ts`, `web/src/lib/pipeline.ts`, `web/src/components/ui.tsx` · **review_mode:** browser · **tdd_target:** false · **assigned_skills:** [agent-browser] · **owning_story:** S-UI-SEL
- **log:** `client`: `enrichSelection`/`enrichmentStatus`/`exportSelection`; tipi `EnrichSummary`/`EnrichmentStatus`. `lib/pipeline`: `useEnrichmentStatus` (poll mentre running) + `useStartEnrichment`; invalidazione selezione a fine job via effect. `ui.tsx`: `StatusBadge` nuovo set + `SelectionStateBadge`. `selections.$date.tsx` riscritto: provenienza+link Run, badge stato, "Esporta" (lock), bulk per bucket + per-riga (disabilitati se job running/fresh/exported), derivati pronto/da-arricchire + "tentato/mai tentato", flag "bozza da rigenerare", pannello esito. agent-browser: provenienza, Esporta→exported+sola-lettura, freshness-disable, add disabled su exported OK. typecheck+build web verdi. (Chiamata Apify reale non esercitata → R1.)
- **description:**
  - `client`/`types`: `enrichSelection`, `enrichmentStatus`, `exportSelection`; tipi `EnrichSummary`, `EnrichmentStatus`; `Selection += run_id, state`; `Contact/SelectionItem += last_enrichment_attempt_at, last_enrichment_actor`; `Stats += freshnessDays`.
  - `lib/pipeline.ts`: `useEnrichmentStatus` (poll mentre running) + `useStartEnrichment` (invalida la selezione a fine job).
  - `ui.tsx`: `StatusBadge` per il nuovo set (`new|enriched|scored|discarded|rejected_geo`).
  - `selections.$date.tsx`: provenienza "Generata dal Run `<run_id>`" (link `/runs`); badge **stato selezione**; segmento "Da arricchire" con bulk "Arricchisci email" (per bucket) + azione per-riga (disabilitati se job running, contatto fresh, o selezione `exported`); distinzione "tentato senza email" vs "mai tentato" (da `last_enrichment_attempt_at`); pannello esito (tentati/recuperate/bozze) dal `result` del job; flag "bozza da rigenerare" per "email senza bozza"; bottone **"Esporta"** (`POST .../export` poi download CSV; disabilitato/nascosto se già `exported`); add/remove disabilitati se `exported`.
- **validation:** agent-browser — provenienza+link presenti; stato selezione mostrato; azioni enrichment con stati disabilitati corretti; "Esporta" porta a `exported` e blocca l'editing; pannello esito popolato a fine job. *(Chiamata Apify non esercitata in browser — vedi R1.)*

---

## Testing strategy

- **Server/pipeline/db → vitest (`cli`)**, mai Apify/Claude reali: `runActor` e `@anthropic-ai/sdk` mockati (`vi.mock`/`vi.hoisted`); job via override `command/args`; DB temp da `tests/setup.ts`.
- **Frontend → agent-browser (`browser`)**: nessun runner FE ([[lead-engine-testing]]); app in esecuzione con DB seed; le azioni Apify validano il wiring UI/stati, non la chiamata reale.
- **TDD:** ogni task backend è `tdd_target` (red→green sul comportamento). Task FE non-TDD.

## Validation gates

1. `npm run typecheck` + `npm test` verdi dopo ogni task backend; i test esistenti (daily job, draft guard, geo-gate, segmentazione) **restano verdi** — adeguare quelli che asseriscono `selected`/`exported` post-run.
2. Walkthrough agent-browser per T8/T9.
3. **Smoke reale `apimaestro` (manuale, fuori CI):** 1–2 contatti reali per validare schema input/output e presenza email pubblica. Sblocca R1.

## Risks

- **R1 — schema input dell'actor `apimaestro` non verificato** (l'output è noto dal campione; l'input no). *Mitig.:* input builder unico-punto + smoke manuale. Isolato a T4.
- **R2 — remodel stati tocca pipeline batch + FE.** *Mitig.:* il modello *toglie* logica (niente sync, niente bug orfano); CSV invariato; enum ridotti; test adeguati. Cambia il significato di `byStatus` (FE si adatta).
- **R3 — migrazione dati legacy** best-effort/lossy. *Mitig.:* guardata+idempotente; `erase` come via pulita (A7).
- **R4 — due run nello stesso giorno:** `saveSelection` (DELETE per data) sostituisce la selezione della prima; `run_id` precedente senza selezione viva. UI "selezione sostituita". Accettato.
- **R5 — contesa file** `app.ts` (consolidata in T7); `web/src/api/*` serializzati T8→T9.

## Unresolved questions

Nessuna bloccante. **A6** (fallback email da `about`) risolta per default consigliato — vetabile.

## Decision ledger (risolto)

| # | Decisione | Fonte |
|---|-----------|-------|
| D1 | Top-up: `runDaily` invariato (salvo ciclo di stato); enrichment additivo on-demand | spec |
| D2 | `apimaestro` affianca `dev_fusion`, solo on-demand | spec |
| D3 | Scopo = recupero email; al recupero → bozza (`draftMany`/Sonnet) | spec |
| D4 | Logica di selezione invariata (top-N) salvo esclusione per membership; Selezione = `run_id` + provenienza | spec OQ#1 |
| D5 | Scrittura enrichment **status-preserving** (`applyProgressiveEnrichment`) | code-inspection |
| D6 | Migrazione idempotente `ensureColumn` + remap legacy | code-inspection |
| D7 | Job enrichment = factory `ui_job` (`ui_job:enrichment`); un job per volta | code-inspection |
| D8 | Retry freshness-gated su `last_enrichment_attempt_at`; bulk **e** singolo (no force) | spec |
| D9 | Trigger: solo pagina Selezione (bulk per bucket + per-riga) in v1 | default |
| D-A | **Run identity: `run_id` reale per esecuzione, su `runs`+`daily_selection`; Run page per-esecuzione** | scelta utente |
| **D-STATE** | **Remodel: `contacts.status` = solo stadio-dato (`new→enriched→scored→discarded→rejected_geo`); Selezione con ciclo `in_review→exported` su `daily_selection.state`; eleggibilità & "già contattato" = membership-derived; `selected`/`exported` rimossi dal contatto** | **scelta utente** |
| **D-DERIVED** | **`pronto`/`da arricchire` = derivati (email presente / `last_enrichment_attempt_at`), mai status; "email senza bozza" = flag UI** | **scelta utente** |
| D-A6 | Email da `apimaestro`: `basic_info.email` con fallback regex su `about` | default consigliato |

---

## Backlog sync

Nessun tracker esterno collegato (solo GitHub PR). Backlog in `brain/`:

- **Epic:** progressive-enrichment → [[specs/lead-engine/progressive-enrichment/SPEC]] (status: Draft → **Planned**).
- **Stories:** S-SCHEMA (T1) · S-STATE (T2) · S-RUNID (T3) · S-ENRICH (T4,T5) · S-JOB (T6) · S-API (T7) · S-UI-RUN (T8) · S-UI-SEL (T9).
- `brain/specs/lead-engine/lead-engine-specs.md` e `brain/index.md` aggiornati (Planned + link PLAN).
