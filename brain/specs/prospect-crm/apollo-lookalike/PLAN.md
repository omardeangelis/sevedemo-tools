---
domain: prospect-crm
type: plan
spec: apollo-lookalike
links:
  - "[[specs/prospect-crm/apollo-lookalike/SPEC|SPEC]]"
  - "[[specs/prospect-crm/apollo-lookalike/FLOW|FLOW]]"
  - "[[specs/prospect-crm/prospect-crm-specs|prospect-crm-specs]]"
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[chore/roadmap-apollo-icp-assistant-profilo|roadmap]]"
created: 2026-09-16
updated: 2026-09-17
---

# PLAN — Aziende simili e contatti via Apollo (`apollo-lookalike`)

**Status:** Complete
**Execution mode:** `parallel` a ondate (decisione del grill, 2026-09-16). W0–W1 sono sequenziali perché
toccano file condivisi (schema, registry, controller); W2 (server) e W3 (frontend) hanno catene parallele
**per file**: ogni task edita solo i file elencati in `files edited/created`, e i file condivisi
(`src/db/schema.ts`, `src/jobs/types.ts`, `src/jobs/handlers.ts`, `src/jobs/fake-deps.ts`,
`src/server/app.ts`, `src/server/jobs.ts`, `web/src/api/*`, `web/src/lib/jobs.ts`) sono pre-cablati da
un solo task della wave precedente. Ogni task server è un tracer bullet RED→GREEN vitest; ogni task FE si
valida con `tsc --noEmit` + `agent-browser` contro il server fake (`E2E_FAKE_JOBS=1`).

> Contratto: [[specs/prospect-crm/apollo-lookalike/SPEC|SPEC.md]] (criteri A–I, regole di somiglianza, regole di unione,
> data model) e [[specs/prospect-crm/apollo-lookalike/FLOW|FLOW.md]] (percorsi A–F, error path, edge case,
> copy). Dove il piano sceglie tra alternative lasciate aperte, lo dice nel ledger (§4) o nelle questioni
> aperte (§15).

---

## 1. Situazione iniziale

- **Base di codice**: working tree di `crm-foundation` **non committato** sopra `a6f203b` (~60 file
  modificati/cancellati). Review adversariale del 2026-09-16: **DO NOT SHIP** con 5 BLOCKER (TD-23…27) e
  11 MAJOR rinviati per scelta dell'utente ([[tech-debt/prospect-crm/crm-foundation]]). Gate dichiarati
  verdi alla chiusura di crm-foundation (`typecheck`, vitest, build web); da riverificare in T0.
- **Decisione del grill**: si parte da un **commit dello stato attuale su `main`** e da un branch
  `apollo-lookalike`; i TD di crm-foundation restano aperti, tranne **TD-25** ("Riprova" salta blocker e
  preview) che questo piano chiude per tutti i job (T6), perché la SPEC I2 lo richiede per tutti i job.
- **Job**: registry `src/jobs/handlers.ts` (`HANDLERS`, `DepsByKind`, `REAL_DEPS`) + dispatcher
  `resolveDeps(kind)` (`src/jobs/deps.ts`: fake con `E2E_FAKE_JOBS=1`) + controller `src/server/jobs.ts`
  (`startJob`, `runningJobBlocker`, `retryJob`, `launchJob`, `JOB_KIND_LABELS`); `JOB_KINDS` in
  `src/jobs/types.ts` guida il `CHECK` su `jobs.kind`. Le route calcolano i blocker di configurazione in
  proprio (`configBlockers` in `routes/enrich.ts`, `planSourcing` in `routes/companies.ts`).
- **Aziende**: `companies.linkedin_url NOT NULL UNIQUE` (`src/db/schema.ts:78`); `createCompany`/
  `updateCompany`/`findCompanyByUrl` in `src/db/companies.ts`; nome default = slug LinkedIn. Nessun
  framework di migrazioni: `applySchema` fa `CREATE TABLE IF NOT EXISTS` e `src/db/index.ts` offre
  `ensureColumn`/`hasColumn` (oggi non usati).
- **Prospect**: `upsertProspect({linkedinUrl, memberUrn, …}, {refresh?, linkByName?})` →
  `{id, created, mergedIds}`; `addSource(id, {kind, companyId|postId, raw})` idempotente sugli indici
  unici parziali; `sources.kind` con `CHECK` e vincolo `company_employees → company_id NOT NULL`.
- **Enrichment**: `src/jobs/enrich.ts` — `EnrichParams {prospectIds|listId, onlyMissing, retryFailed}`,
  `planEnrichment` (salta `enriched_at` non nullo e tentativi recenti), `applyEnrichment` (scrive
  `enriched_at`, attività `enrichment` con `meta.actor`), `Deps.fetchProfile`; route `routes/enrich.ts`
  (`GET /api/enrich/preview`, `POST /api/prospects/:id/enrich | /enrich | /lists/:id/enrich`).
- **Analisi**: richiede prospect arricchito (`enriched_at`/`about`, `src/jobs/analyze.ts:77-84`).
- **Frontend**: `web/src/api/{types,client}.ts` (`api.*`, `queryKeys`, `SOURCE_KINDS`, `SOURCE_KIND_LABELS`),
  `web/src/lib/jobs.ts` (`JobPreviewParams`, `fetchPreview` switch, `useJobPreview`, `useJobStart`,
  `JOB_KIND_LABELS`), `JobPreviewDialog` (conteggi con `countLabels`, `summary`, `children` per le
  opzioni), `ListPicker`, `EnrichDialog` in `components/BulkBar.tsx` (bulk) e in `routes/prospects.$id.tsx`
  (singolo), icone/etichette fonte in `ProspectTable.tsx`, `prospects.$id.tsx`, `inbox.tsx`. Pagine:
  `icps.$id.tsx` (896 righe: form ICP + referenze), `companies.$id.tsx` (718), `companies.index.tsx` (354).
- **Export CSV**: `src/exports/list-export.ts` → `sourcesText` con `switch` sul kind.
- **Server e2e**: `scripts/e2e-server.ts` + `src/jobs/fake-deps.ts` + `tests/fixtures/e2e/` +
  `tests/e2e/README.md` (trigger `__fixture`, parole chiave nei dati).
- **Apollo**: `APOLLO_API_KEY` nel `.env` dell'utente, non letta da `src/config.ts`. Piano a pagamento con
  master key (D-E). Nessun codice Apollo esiste.

## 2. Problema

Le aziende target si inseriscono a mano e il lookalike è solo un seam documentato. Serve: trovare aziende
simili alle referenze su Apollo con preview dei crediti, farle vagliare, trovare le persone giuste nelle
accettate verso una lista dell'ICP, e opzionalmente l'email di lavoro; con l'identità azienda che accetta
il dominio (D-A), senza toccare lo stato "arricchito" dei prospect (SPEC G5), senza automatismi (D-B) e
senza mai inventare un prezzo.

## 3. Forma della soluzione

- **Modulo Apollo** `src/apollo/`: `client.ts` (fetch nativo, `x-api-key`, 429 → `retry-after` ≤ 60 s,
  ≤ 3 tentativi, errori `actor:apollo:<op>:` / `config:` per 401/403), `requests.ts` (**unico punto** dei
  body: `enrichOrganizationsRequest`, `searchOrganizationsRequest`, `searchPeopleRequest`,
  `matchPeopleRequest`), `mappers/organizations.ts` + `mappers/people.ts` (puri, `field()`),
  `similarity.ts` (derivazione filtri + punteggio, puro, regole SPEC).
- **Identità azienda**: `src/util/fields.ts#normalizeDomain`, `src/db/companies.ts#upsertCompany`,
  `src/db/company-identity.ts#mergeCompanies`, migrazione con ricostruzione tabella + backup in
  `src/db/schema.ts` (`migrateCompaniesDualKey`).
- **Candidate**: tabella `icp_company_candidates` + `src/db/candidates.ts` (tutta l'API dati, scritta una
  volta in T5) + route `src/server/routes/candidates.ts`.
- **Job**: `enrich_companies` (`src/jobs/enrich-companies.ts`, route `routes/enrich-companies.ts`: referenze
  di un ICP o singola azienda), `lookalike_companies` (`src/jobs/lookalike-companies.ts`, route
  `routes/lookalike.ts`) e `apollo_people` (`src/jobs/apollo-people.ts`, route `routes/contacts.ts`);
  `enrich` con `params.provider` (`src/enrich/apollo-match.ts` per l'applicazione).
- **Controller**: registry `CONFIG_BLOCKERS[kind](params)` in `handlers.ts` (ogni kind esporta
  `configBlockers`), usato da route e da `retryJob` (T6).
- **Frontend**: fondazione (tipi/client/hook) → pagina ICP con `LookalikeCard`, `LookalikeDialog`,
  `CandidatesTable`, `ContactsDialog` (con `IcpForm` estratto) → `EnrichDialog` con provider + etichette
  fonte `apollo_people` → pagine Aziende con dominio, 409 + "Unisci in", candidata per ICP.

## 4. Decision ledger

### Decisioni di prodotto (SPEC, 2026-09-16)

| # | Decisione | Esito |
|---|---|---|
| D-A | Identità aziende | Doppia chiave `linkedin_url` \| `domain`, almeno una; unione automatica nei job, esplicita ("Unisci in") per l'utente |
| D-B | Default pipeline | Triage manuale; `autoContacts` opt-in, le candidate restano `proposta` |
| D-C | Email | Apollo come secondo provider di enrichment; **non** tocca `enriched_at`; `apollo_matched_at` |
| D-E | Piano Apollo | A pagamento con master key; readiness = chiave presente; permessi al primo job (`config:`) |
| S-1 | Somiglianza | Deterministica: parole chiave (top 10 per frequenza, tie-break alfabetico, + ICP oltre le 10), fasce Apollo ± adiacenti + intersezione con `company_size`, località = città (1) / regione (0,5) delle referenze arricchite; punteggio 0,5/0,3/0,2 a 2 decimali; componente località **esclusa e pesi rinormalizzati** (÷ 0,8) se la candidata non ha né città né regione; `score_parts` + `scoring_version` sulla candidata; esempio numerico in SPEC (Gamma 0,67 · Delta 0,57 · Epsilon 0,58) = fixture |
| S-2 | Rilancio | Stessi filtri (insiemi normalizzati) → continua dalla pagina successiva (derivato dai job), "Ricomincia dalla pagina 1" esplicito |
| S-3 | Arricchimento referenze | Job separato `enrich_companies` con la sua preview (SPEC C): la ricerca non arricchisce mai; i filtri derivano solo da referenze arricchite + ICP |
| S-4 | Esiti parziali | Arresto dopo ≥ 1 pagina/azienda salvata = `succeeded` + warning (SPEC D12, F10, G7, H3); prima = `failed` |
| S-5 | Unione aziende | Regole di unione della SPEC: nei job superstite = chi ha l'URL, altrimenti id minore; in B5 = l'azienda indicata; COALESCE; "chiavi in conflitto" = skip contato |
| S-6 | Contatti Apollo (steering 2026-09-17) | La People API Search non restituisce URL LinkedIn/dominio (docs verificate): `apollo_people` = ricerca gratuita per azienda + `people/bulk_match` per id delle persone trovate (1 credito a persona, lotti da 10); preview `est_credits` = fino a aziende × tetto; il match salva anche email di lavoro e `apollo_matched_at`; pipeline (H) con la stessa stima. La scelta delle aziende resta del triage. T8/T9/T13/T16 aggiornati di conseguenza |
| S-7 | Arricchimento candidate (steering 2026-09-17, dopo lo smoke) | La ricerca aziende non restituisce settore/parole chiave/dipendenti/sede (0/5): `lookalike_companies` arricchisce nello stesso job le aziende nuove non già arricchite (1 credito ciascuna, lotti da 10, stessa logica di T7c) prima del punteggio; dialog con dimensione di pagina 25 · 50 · 100 (default 25); `est_credits` = pagine + fino a pagine × dimensione; D6 "esaurita" = ultima pagina < dimensione e continuazione solo a parità di dimensione. T7a/T7b/T9/T12a/T13/T16 aggiornati |

### Decisioni del grill (2026-09-16, con l'utente)

| # | Decisione | Raccomandazione accettata | Conseguenza nel piano |
|---|---|---|---|
| G-1 | Base git | Commit dello stato attuale su `main` + branch `apollo-lookalike`; TD crm-foundation restano aperti | T0 |
| G-2 | "Riprova" e blocker | Fix **globale** nel controller: registry `CONFIG_BLOCKERS`, `retryJob` → 400 `blocked`; chiude TD-25 | T6, sequenziale in W1 |
| G-3 | Riga candidata | Badge "già cercata il <data>" derivato dalle fonti `apollo_people` (nessun conteggio N) | T5 (`lastContactsByCompany`), T11, T13 |
| G-4 | Esecuzione | `parallel` a ondate per file | §8 |

### Decisioni sulle domande aperte (2026-09-17, con l'utente)

| # | Decisione | Conseguenza nel piano |
|---|---|---|
| U-1 | Seniority: tutte e 9, nessuna preselezionata (SPEC OQ-1) | T13 invariato |
| U-2 | Nessuna soglia; "paese" → "località" città/regione, sede assente esclusa con rinormalizzazione (SPEC OQ-2, Regole di somiglianza) | T2 (`scoreCandidate` → `parts`, `state` nel mapper), T7b (`without_location`) |
| U-3 | "Trova contatti" anche dal dettaglio azienda (SPEC F12) | T13 (`ContactsDialog` in modalità "tutte le liste"), T15 (bottone + data), T18 (percorso) |
| U-4 | Pesi costanti ma ricerche analizzabili (SPEC D14): `score_parts`, `scoring_version`, distribuzione fascia × stato per ricerca | T5 (colonne, `runStats`), T7a (`runs[].stats`), T12a (riga "Ricerche precedenti"), T16 (fixture con sede assente) |

### Decisioni prese in pianificazione (derivate da SPEC/FLOW/codice; contestabili)

| # | Decisione | Perché |
|---|---|---|
| P-1 | Migrazione `companies` = ricostruzione tabella in `applySchema` con backup consistente `VACUUM INTO 'data/crm.db.bak-<ISO>'` (solo se `linkedin_url` è ancora `NOT NULL`; rifiutata se `findRunningJobs()` ha un pid vivo), `PRAGMA foreign_keys=OFF` fuori transazione, `foreign_key_check` alla fine, abort senza scritture se qualcosa fallisce, messaggio d'errore con il percorso del backup; il backup contiene dati personali: `.gitignore` copre `data/` e `*.bak-*` (T0) | SQLite non toglie `NOT NULL` con `ALTER`; SPEC B9/B10 |
| P-2 | `upsertCompany({linkedinUrl?, domain?, name?, website?, industry?, size?, location?, apollo?}, {refresh?}) → {id, created, mergedIds}`; risoluzione: per URL, poi per dominio; se entrambe le chiavi puntano a righe diverse → `mergeCompanies(keep=quella con linkedin_url, drop=l'altra)` | Stesso modello di `upsertProspect`/`mergeProspects` |
| P-3 | `POST /api/companies/:id/merge {into}` = unione esplicita (resta `into`, sparisce `:id`); 409 di chiavi duplicate porta `code:'company_exists'`, `company_id`, `company_name` | SPEC B3/B4, FLOW F.4 |
| P-4 | Stato "ultima ricerca" per ICP e "ultima pagina letta" = ultimo job `lookalike_companies` `succeeded` con `params.icpId` e `result.counts.last_page` + `params.filtersHash`; "già cercata il <data>" per azienda = `MAX(captured_at)` delle `sources` `apollo_people` con quel `company_id` (SPEC E5; vale anche dopo la pipeline e i job parziali) | SPEC Data model: derivati, non colonne |
| P-5 | Un solo job per la pipeline: `lookalike_companies` con `params.autoContacts: {listId, roles, seniorities, locations, perCompany}`; a fine ricerca chiama `runApolloPeople(...)` esportata da `apollo-people.ts` sugli id delle candidate create; esito con entrambi i blocchi di conteggi | SPEC H2 "un solo job" |
| P-6 | People search: **una richiesta per azienda** (`q_organization_domains_list: [domain]`, `per_page = perCompany`, `page 1`); `counts.requests` = aziende con dominio | SPEC F2: tetto per azienda osservabile |
| P-7 | Ambito Apollo dell'enrich: `provider:'apollo'` → `planEnrichment` usa `email IS NULL` e `apollo_matched_at` (freshness) al posto di `enriched_at`/`enrichment_attempted_at`; `onlyMissing` ignorato (sempre true); `apollo_matched_at` scritta solo a risposta ricevuta | SPEC G2/G5/G6 |
| P-8 | Punteggio in API 0–1, in UI "82 %" | FLOW OQ-8 |
| P-9 | ~~"Trova contatti" dal dettaglio azienda rinviato~~ → sostituita da U-1..U-4 il 2026-09-17: seniority tutte e 9, nessuna soglia, F12 incluso, statistiche per ricerca | Decisioni dell'utente |
| P-10 | Enrich Apollo resta kind `enrich` (provider in `params`); etichette dei kind in P-16 | Un kind per job, il provider è un parametro |
| P-11 | `apollo_json` conserva la risposta grezza dell'organizzazione (per assistente ICP e debug); `apollo_person_id` sul prospect è chiave secondaria: scritta solo se nessun altro prospect la possiede (`apollo_id_taken` contato), mai usata per risolvere l'identità | SPEC F6, Data model |
| P-12 | Esito parziale = il handler cattura l'errore dopo la prima pagina/azienda salvata, chiude con `warnings` e `counts` completi; `result.counts.last_page` sempre presente | S-4, `completeJob` azzera `result` sui `failed` |
| P-13 | `enrich_companies`: `params {companyIds[], icpId?}`; `Deps.enrichOrganizations(domains)` (bulk da 10); per organizzazione → `upsertCompany` con Regole di unione (`merged`, `linkedin_acquired`, `key_conflict`); referenza non trovata → `apollo_enriched_at = now`, `apollo_org_id = null`; preview esclude `apollo_enriched_at` recente (`FRESHNESS_DAYS`) | SPEC C2–C6 |
| P-14 | `CONFIG_BLOCKERS` si compila **dopo** che ogni preview esiste (T6 a fine W2): fino ad allora `retryJob` resta com'è | ux-advisor §9 |
| P-15 | Limite accettato di D12: se il **processo** muore (kill, crash) il controller scrive `failed` e `result` è nullo → le pagine già salvate restano (aziende e candidate non riproposte) ma la ripartenza D6 riparte dalla pagina 1 con avviso; ogni altro arresto (429, 5xx, 403) è gestito nell'handler come parziale `succeeded` | `completeJob` azzera `result` sui `failed`; FLOW "Processo figlio muore" |
| P-16 | Etichette `JOB_KIND_LABELS`: `enrich_companies` "Arricchimento aziende (Apollo)", `lookalike_companies` "Aziende simili (Apollo)", `apollo_people` "Contatti Apollo"; il kind `enrich` mostra "Arricchimento (Apollo)" nel JobBanner quando `params.provider === 'apollo'` (FE, T12) | FLOW Entry points |
| P-17 | Candidate: il server risponde tutte le righe filtrate per stato (cap 500, ordinate per punteggio poi nome); la tabella pagina lato client a 50 con `cpage` nell'URL; "seleziona tutte le filtrate" agisce sulle righe caricate | SPEC E1/E2; FLOW B.1 |
| P-19 | "Nessuna referenza con sito/arricchita" è **warning**, non blocker (SPEC D4/D5): copy della card "Nessuna referenza con sito: i filtri derivano solo dall'ICP" | FLOW A.2 riallineato |
| P-18 | Edge FLOW "Dominio già usato da <altra azienda>" nel dettaglio: **deviazione** dichiarata, rinviata (solo log alla migrazione + 409 alla modifica manuale); T18 la registra nel tech-debt | Costo/beneficio; SPEC B8 richiede solo il log |

## 5. Assunzioni e vincoli

- Nessuna chiamata Apollo da test, e2e o validazione: `client.ts` riceve `fetch` iniettabile; i job
  ricevono `Deps` (`enrichOrganizations`, `searchOrganizations`, `searchPeople`, `matchPeople`).
- Lo smoke reale (T0) è **manuale**, con conferma interattiva, e consuma ≈ 3 crediti; le sue risposte,
  anonimizzate, diventano le fixture di `tests/fixtures/apollo/`. Se T0 smentisce un'assunzione (nomi dei
  campi, limiti), si aggiorna §7 e i task T2/T3 prima di scrivere codice.
- Fatti Apollo assunti (roadmap §4): `POST /api/v1/organizations/bulk_enrich {domains[]}` 1 credito per
  organizzazione (bulk 10); `POST /api/v1/mixed_companies/search` 1 credito/pagina, `per_page ≤ 100`;
  `POST /api/v1/mixed_people/api_search` 0 crediti, richiede master key o scope
  `mixed_people_api_search`; `POST /api/v1/people/bulk_match {details[]}` 1 credito/persona,
  `reveal_personal_emails:false`, `reveal_phone_number:false`; 429 con `retry-after`; header
  `x-rate-limit-*` da leggere e stampare in T0.
- Nessuna dipendenza npm nuova. UI, commenti ed errori in italiano. Gate: `npm run typecheck`, `npm test`,
  `npm --prefix web run build`, `npm --prefix web run typecheck`.
- I TD di crm-foundation non in ambito restano tali; il piano non peggiora TD-26/TD-37 (nessun
  `linkByName` nei job Apollo: le persone Apollo hanno sempre l'URL, altrimenti si scartano).
- I worker paralleli usano porte e DB e2e distinti (`UI_PORT=<porta> npm run e2e:server`) e fermano i
  processi per PID.

## 6. Modello dati (delta DDL)

```sql
-- companies (ricostruita da migrateCompaniesDualKey; P-1)
CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url TEXT,                 -- normalizzato, nullable
  domain TEXT,                       -- normalizeDomain(): minuscolo, senza schema/porta/path/query, senza 'www.'
  name TEXT, website TEXT, industry TEXT, size TEXT, location TEXT, notes TEXT,
  apollo_org_id TEXT, apollo_json TEXT CHECK (apollo_json IS NULL OR json_valid(apollo_json)),
  apollo_enriched_at TEXT,
  created_at TEXT NOT NULL DEFAULT …, updated_at TEXT NOT NULL DEFAULT …,
  CHECK (linkedin_url IS NOT NULL OR domain IS NOT NULL)
);
CREATE UNIQUE INDEX ux_companies_linkedin ON companies(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE UNIQUE INDEX ux_companies_domain   ON companies(domain)       WHERE domain IS NOT NULL;
CREATE UNIQUE INDEX ux_companies_apollo   ON companies(apollo_org_id) WHERE apollo_org_id IS NOT NULL;
-- backfill: UPDATE companies SET domain = normalizeDomain(website) dove domain IS NULL e non collide (collisione → log server)

CREATE TABLE IF NOT EXISTS icp_company_candidates (
  icp_id     INTEGER NOT NULL REFERENCES icps(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta','accettata','scartata')),
  score      REAL NOT NULL DEFAULT 0,
  reasons    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons)),
  job_id     INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  score_parts     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(score_parts)),  -- {keywords, size, location|null}
  scoring_version TEXT NOT NULL DEFAULT 'v1',
  created_at TEXT NOT NULL DEFAULT …,
  decided_at TEXT,
  PRIMARY KEY (icp_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_candidates_job ON icp_company_candidates(job_id);  -- statistiche per ricerca (SPEC D14)

-- sources.kind: + 'apollo_people'; CHECK (kind NOT IN ('company_employees','apollo_people') OR company_id IS NOT NULL)
-- prospects: + apollo_person_id TEXT (ensureColumn) + UNIQUE parziale; + apollo_matched_at TEXT (ensureColumn)
-- jobs.kind: + 'lookalike_companies', 'apollo_people'  (CHECK rigenerato: tabella jobs ricostruita? NO —
--   il CHECK di jobs è nel CREATE TABLE IF NOT EXISTS: sui DB esistenti va ricostruita anche `jobs` (stessa
--   procedura di P-1, senza backup aggiuntivo: la migrazione fa un solo backup all'inizio). Vedi T5.)
```

> `sources` ha lo stesso problema di `jobs` (CHECK sul kind nel `CREATE TABLE`): T5 estende la procedura di
> ricostruzione a `sources` e `jobs` quando il CHECK non contiene i nuovi valori (rilevato con
> `sqlite_master.sql`). La ricostruzione è generica (`rebuildTable(name, newDdl, copyColumns)`), scritta in
> T4a e riusata in T5.

Enum nuovi in `src/db/schema.ts`: `CANDIDATE_STATUSES = ['proposta','accettata','scartata']`,
`SOURCE_KINDS + 'apollo_people'`, `APOLLO_SENIORITIES = ['owner','founder','c_suite','vp','head','director','manager','senior','entry']`
(in `src/apollo/requests.ts`), `APOLLO_EMPLOYEE_RANGES` (in `src/apollo/similarity.ts`).

## 7. Ricerca esterna usata

- Apollo API reference (consultata il 2026-09-16 nella sessione di roadmap, da riconfermare con T0):
  Organization Enrichment / Bulk (`/v1/organizations/enrich`, `/v1/organizations/bulk_enrich`),
  Organization Search (`/v1/mixed_companies/search`: `q_organization_keyword_tags[]`,
  `organization_num_employees_ranges[]` come `"1,10"`, `organization_locations[]`, `page`, `per_page`;
  risposta `organizations[]` + `pagination{page, per_page, total_entries, total_pages}`), People API
  Search (`/v1/mixed_people/api_search`: `person_titles[]`, `person_seniorities[]`,
  `q_organization_domains_list[]`, `person_locations[]`, `page`, `per_page`; risposta `people[]` con
  `id`, `name`, `first_name`, `last_name`, `title`, `linkedin_url`, `seniority`, `city`, `country`,
  `organization{name, primary_domain, website_url, linkedin_url}`; niente email/telefono), People
  Enrichment / Bulk (`/v1/people/match`, `/v1/people/bulk_match`: `linkedin_url` o `id`,
  `reveal_personal_emails`, `reveal_phone_number`; risposta `person{email, title, organization}`), Rate
  limits (429 + `retry-after`, header `x-rate-limit-minute/hourly/daily`, piani a pagamento ~200/min).
- Campi organizzazione usati dal mapper (tolleranti con `field()`): `id`, `name`, `website_url`,
  `primary_domain`, `linkedin_url`, `industry`, `keywords[]`, `estimated_num_employees`, `country`,
  `city`, `state`, `short_description`.
- SQLite: `ALTER TABLE` non modifica `NOT NULL`/`CHECK` → procedura "12 passi" della documentazione
  ufficiale (nuova tabella, copia, drop, rename, `foreign_key_check`) con `foreign_keys=OFF` fuori
  transazione.

### Esiti dello smoke reale (2026-09-17, chiave dell'utente)

- `organizations/bulk_enrich` con `domains[]` in query: 200, tutti i campi descrittivi (`industry`, `keywords`,
  `estimated_num_employees`, `city`, `state`, `country`, `raw_address`, `short_description`, …).
- `mixed_companies/search`: 200, `organizations[]` con `id, name, website_url, linkedin_url, primary_domain,
  organization_revenue, founded_year…` ma **0/5** su settore, parole chiave, dipendenti, città/regione/paese;
  `accounts: []`; `pagination{page, per_page, total_entries, total_pages}` → decisione S-7.
- `mixed_people/api_search`: 200 (permesso ok), `people[]` con `id, first_name, last_name_obfuscated, title,
  has_*`, `organization{name, has_*}`, `total_entries`; **nessun** `linkedin_url` né dominio → decisione S-6.
- `people/bulk_match` per id e per `linkedin_url`: 200, `matches[]` completi (`linkedin_url`, `email`,
  `email_status`, `organization` con tutti i campi descrittivi), `credits_consumed` in cima; stessa persona
  ripetuta se due dettagli la identificano (T10: allineare per posizione).
- **Rate limit per endpoint** (header `x-rate-limit-*`, `x-*-requests-left`): arricchimento e match 20/min,
  100/h, 600/24h; ricerche 50/min, 200/h, 600/24h. `APOLLO_RATE_LIMIT_PER_MINUTE` default portato a 20; il
  client rispetta gli header (attesa sul minuto, errore immediato su ora/giorno esauriti → esito parziale).

## 8. Grafo delle dipendenze e ondate

```
W0   T0  commit + branch + script smoke
W1a  T1  config/readiness
W1b  T2 mapper + somiglianza (puri)  ∥  T3 client Apollo        → poi T4a identità azienda (dopo T2: usa `normalizeDomain`)
W1c  T5  schema candidate + colonne prospect + 3 kind + stub + pre-cablaggio + contratto params/result
W2a  T4b route aziende ∥ T7a preview lookalike + storico ricerche ∥ T7c job enrich_companies ∥ T8 job apollo_people ∥ T10 enrich provider ∥ T11 API candidate
W2b  T12a tracer bullet FE (readiness + card A + LookalikeDialog in preview)   [dopo T7a, T7c]
W2c  T7b job lookalike → T9 pipeline (dopo T7b, T8) → T16 fake-deps/fixture e2e (dopo T9, T7c, T10: simula i `Deps` definitivi)
W2d  T6  "Riprova" ripassa dai blocker, globale (dopo T7a, T7c, T8, T10, T11)
W3a  T12 fondazione FE completa (dopo T12a, T9, T10, T11, T16, T6)
W3b  T13 pagina ICP ∥ T14 enrich provider + fonti (dopo T12)
W3c  T15 pagine Aziende (dopo T12, T4b e T13: riusa `ContactsDialog` in `mode: 'company'`, U-3)
W4   T17 README/AGENTS/IMPLEMENTATION-NOTES (dopo T13–T15) → T18 smoke e2e agent-browser
```

Regole anti co-edit (proprietario → file): T4a → `src/db/schema.ts`, `src/db/index.ts`, `src/db/companies.ts`,
`src/db/company-identity.ts`; T5 → `src/db/schema.ts` (dopo T4a), `src/db/candidates.ts`, `src/db/prospects.ts`,
`src/jobs/types.ts`, `src/jobs/handlers.ts`, `src/jobs/fake-deps.ts` (stub), `src/server/app.ts`,
`src/server/jobs.ts` (etichette), stub dei 3 job e delle 4 route; T4b → `src/server/routes/companies.ts`
(+ T6 solo per la riga `configBlockers`); T7a/T7b/T9 → `src/jobs/lookalike-companies.ts`,
`src/server/routes/lookalike.ts` (in sequenza); T7c → `src/jobs/enrich-companies.ts`,
`src/server/routes/enrich-companies.ts`; T8 → `src/jobs/apollo-people.ts`, `src/server/routes/contacts.ts`,
`src/exports/list-export.ts`; T10 → `src/jobs/enrich.ts`, `src/server/routes/enrich.ts`,
`src/enrich/apollo-match.ts`; T11 → `src/server/routes/candidates.ts`, `src/db/icps.ts`; T6 →
`src/server/jobs.ts`, `src/server/routes/jobs.ts`, `src/jobs/{sync-interactions,source-company,analyze}.ts`
e le route `sync`/`analyze` + una funzione `configBlockers` per ciascuno dei file già chiusi da W2a; T16 →
`src/jobs/fake-deps.ts`, `tests/fixtures/e2e/*`, `tests/e2e/README.md`, `scripts/e2e-server.ts`; T12a poi
T12 → `web/src/api/*`, `web/src/lib/jobs.ts`, `web/src/routes/settings.tsx`, `web/src/routes/index.tsx`
(T12a anche `icps.$id.tsx` per la card, poi T13); T13 → `web/src/routes/icps.$id.tsx` e i nuovi componenti;
T14 → `BulkBar.tsx`, `prospects.$id.tsx`, `ProspectTable.tsx`, `inbox.tsx`, `lists.$id.tsx`; T15 →
`companies.index.tsx`, `companies.$id.tsx`, `SourceCompanyDialog.tsx`.

## 9. Ordine consigliato dall'UX (ux-advisor, 2026-09-16) — recepito

- **Momento più ansiogeno = la preview della ricerca (FLOW A.2)** e, con la SPEC v3, quella
  dell'arricchimento (A.1b): crediti, "stima non disponibile", "continuo dalla pagina 2", blocker. Recepito:
  la preview è calcolo puro su DB → **T7a** (preview + route senza job) subito dopo le fondamenta, e un
  **tracer bullet FE T12a** (readiness + card + dialog in sola preview) verificato con agent-browser prima
  del job (T7b) e prima di triage/contatti (T13).
- **W1 accorciata**: T2 ∥ T3 in parallelo, poi T4a; T4b spostato in W2a (i job usano solo `upsertCompany`/
  `mergeCompanies`); T6 spostato a fine W2 perché "Riprova" deve ripassare dai blocker che esistono solo
  dopo le preview di T7a/T7c/T8/T10.
- **Error path con proprietario esplicito**: scritture per pagina in transazione e `apollo_enriched_at`
  prima della ricerca (T7c/T7b); testi `config:` 401/403 e banner rosso persistente (T7b/T8 + T12);
  esito parziale dell'email (T10); bulk candidate per item e PATCH idempotente (T11); "dichiarate vs
  riconosciute" (T2 → T7b); check lista/config in cima all'handler (T7c/T8/T9/T10); TD-25 (T6).
- **Edge case assegnati**: referenza solo-LinkedIn ritrovata → unione, referenza di un altro ICP →
  candidata normale (T7b); promozione a referenza + toast (T11 + T13); eliminazione ICP → cascade (T5) +
  copy (T13); collisioni di dominio in migrazione (T4a log) e "già usato da <altra>" nel 409 (T4b + T15);
  "Ricerche precedenti" / "Riusa questi filtri" / "Riprova con altri filtri" → endpoint storico (T7a) +
  card (T12a/T13); "già cercata il <data>" (T5 query, T11, T13); > 50 % senza LinkedIn → warning (T7b,
  T8); ICP senza ruoli → warning, non blocker (T8, SPEC F3); invalidazione query al termine del job (T12).
- **Vincoli di sequenza** (tutti nel grafo §8): T1 prima di T2/T3/T4a (config a import time); T4a prima
  di T5; T5 prima di ogni W2; T2 prima di T7a; T7a/T7c prima di T12a; T7b e T8 prima di T9; T7a/T7c/T8/T10/T11
  prima di T6; T16 prima di T13/T14/T15; T4b prima di T15; T12a prima di T13.

## 10. Strategia di test

- **Mapper e somiglianza** (T2): puri, fixture JSON in `tests/fixtures/apollo/`; test tabellare con
  l'**esempio di riferimento della SPEC** (Acme/Beta/Gamma → filtro atteso, punteggio 0,67, 3 ragioni) e i
  casi limite (0 parole chiave → componente 0; candidata senza tag; `company_size` `"10-50"` e `"50+"`;
  tie-break alfabetico; ICP oltre le 10). Persone: senza URL → scartata; "dichiarate vs riconosciute".
- **Client** (T3): `fetch` iniettato; 429 con `retry-after: 0` → ritenta; oltre i tentativi → errore
  `actor:apollo:<op>:`; 401/403 → `config:` con i testi del FLOW; 5xx/rete → `actor:`; body = snapshot.
- **Identità azienda** (T4a): upsert per URL / dominio / entrambe; Regole di unione (superstite, COALESCE,
  relazioni, conflitto a chiavi piene, `apollo_org_id` altrui); migrazione su DB temporaneo con lo schema
  vecchio → colonne, righe, FK, backup consistente (`VACUUM INTO`), idempotenza.
- **Job** (T7b, T7c, T8, T9, T10): `Deps` fake da fixture; verifiche su DB e conteggi; idempotenza al
  secondo run; rate limit e 5xx simulati → `succeeded` parziale con `warnings`/`last_page`, oppure
  `failed` se prima della prima scrittura; 403 → `config:`; pipeline con errore nel passo contatti.
- **Route** (T4b, T7a, T7c, T8, T10, T11): `createApp().request()`; preview con e senza chiave
  (`config.apolloApiKey=''`), 400 `blocked`, 202, 409 `job_running`, 409 `company_exists`, bulk per item.
- **Retry** (T6): per ogni kind, job `failed` + blocker → 400 `blocked`; senza → 202.
- **Frontend** (T12a, T12–T15, T18): `tsc --noEmit` dopo build; `agent-browser` contro `npm run e2e:server`
  con le fixture di T16 e i trigger `__fixture` (`EMPTY`, `FAIL`, `FAIL_ONCE`, `PARTIAL`, `NOSCOPE`) e
  `E2E_NO_APOLLO=1`.

## 11. Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Campi/endpoint Apollo diversi da §7 | T0 prima di T2/T3; fixture dalle risposte reali; mapper tolleranti; §16-1/2 |
| Ricostruzione di `companies`/`sources`/`jobs` corrompe `data/crm.db` | Backup consistente prima, tutto-o-niente, `foreign_key_check`, test su DB vecchio; abort = server non parte con messaggio |
| Chiave senza permesso → 403 a metà pipeline | SPEC H3: esito parziale riuscito, candidate salvate, warning con rimedio |
| Rate limit su job lunghi | Backoff nel client; `counts.requests` in preview; esito parziale idempotente |
| `icps.$id.tsx` ingestibile | T12a/T13 estraggono `IcpForm` e creano componenti separati |
| Drift API ↔ FE | T12a consuma il contratto §12 con una sola preview; T12 parte a W2 chiusa |
| Co-edit dei file condivisi | Pre-cablaggio in T5; mappa proprietari §8; `git diff --stat` per task |
| Analisi rese `stale` dalle scritture Apollo | Accettato in SPEC (Constraints); README lo dice |
| Referenze mai arricchite → filtri poveri | Warning in preview (D5) e riga card con "Arricchisci referenze" (T12a) |

## 12. Contratto API (server → FE)

- `GET /api/settings` → `readiness.apollo: boolean`.
- **Aziende** (T4b): `POST /api/companies {linkedin_url? | website?, name?, …}` → 201; chiave duplicata →
  409 `{error, code:'company_exists', company_id, company_name}`; `PATCH /api/companies/:id` idem, entrambe
  le chiavi vuote → 400; `POST /api/companies/:id/merge {into}` → 200 `{company}` (superstite = `into`, l'azienda
  indicata dal 409, come SPEC B5; la regola "chi ha l'URL / id minore" vale per i job); `GET /api/companies?q=` cerca
  anche per dominio; `GET /api/companies/:id` → `+ domain, apollo_org_id, apollo_enriched_at`; sourcing
  preview → blocker senza `linkedin_url`.
- **Arricchimento aziende** (T7c): `GET /api/icps/:id/enrich-companies/preview?retryNotFound=` e `POST
  /api/icps/:id/enrich-companies {retryNotFound?}` (referenze dell'ICP con dominio non arricchite di
  recente); `GET /api/companies/:id/enrich-apollo/preview` e `POST /api/companies/:id/enrich-apollo`
  (singola). `EnrichCompaniesParams {companyIds[], icpId?, retryNotFound}` congelati dalla route.
  Preview: `counts {references, with_domain, to_enrich, skipped_fresh, est_credits}`; esito `counts {enriched,
  not_found, merged, linkedin_acquired, key_conflicts, credits_used}`.
- **Ricerca** (T7a/T7b/T9): `GET /api/icps/:id/lookalike/preview?pages=&keywords=&ranges=&locations=&restart=`
  → `JobPreview` (`counts {pages, est_credits, requests}`) + `filters {keywords[], ranges[], locations[],
  origins: Record<string, string[]>, notes[]}` + `resume {last_page, next_page, last_run_at} | null` +
  `references [{company_id, name, domain, enriched_at}]`; `GET /api/icps/:id/lookalike/runs` → ultimi 5 job
  derivati `{id, at, filters, counts, state, stats: {proposed, without_location, buckets: {basso, medio, alto}
  → {proposta, accettata, scartata}}}` (SPEC D14: dalle candidate con quel `job_id`; fasce da `SCORE_BUCKETS`); `POST /api/icps/:id/lookalike {pages, keywords, ranges,
  locations, restart?, autoContacts?: {listId, roles, seniorities, locations, perCompany}}` → 202 | 400
  `blocked` | 409. Result `counts {read, new_candidates, known, without_linkedin, merged,
  references_completed, key_conflicts, no_keys, pages_read, last_page, last_page_declared, credits_used, requests}` (+ `contacts_*` in
  pipeline) e `warnings[]`.
- **Candidate** (T11): `GET /api/icps/:id/candidates?status=` → `{items: [{company_id, name, domain,
  linkedin_url, industry, size, location, score, score_parts {keywords, size, location|null}, scoring_version,
  reasons[], status, created_at, decided_at, last_contacts_at}], total, counts {proposta, accettata, scartata},
  last_run: {at, read, new_candidates} | null}` (tutte le righe dello stato, cap 500, ordinate per punteggio poi nome; paginazione lato client, P-17);
  `PATCH /api/icps/:id/candidates/:companyId {status}` → 200 (idempotente); `POST
  /api/icps/:id/candidates/bulk {company_ids, status}` → `{updated, failed: [{company_id, error}]}`;
  `GET /api/companies/:id/candidate-of` → `{items: [{icp_id, icp_name, status, score, decided_at}]}`.
- **Contatti** (T8): `GET /api/icps/:id/contacts/preview?companyIds=&listId=&roles=&seniorities=&locations=&perCompany=`
  → `JobPreview` (`counts {companies, with_domain, without_domain, requests, est_credits: 0}`); `POST
  /api/icps/:id/contacts {companyIds, listId, roles, seniorities, locations, perCompany}` → 202. Result
  `counts {people_read, companies_done, companies, without_domain, added, prospects_new, prospects_seen,
  already_in_list, skipped_no_url, apollo_id_taken, requests}`. Dal dettaglio azienda (SPEC F12) la FE usa gli
  stessi endpoint con `:id` = ICP della lista scelta e `companyIds=[id]`; la route verifica già che la lista
  appartenga all'ICP; `GET /api/companies/:id/contacts-at` → `{last_contacts_at}` (T11, da
  `lastContactsByCompany`).
- **Enrich** (T10): `GET /api/enrich/preview?…&provider=apollo` → `counts {selected, targets,
  skipped_with_email, skipped_fresh, not_found, est_credits}`; `POST …/enrich {provider:'apollo',
  retryFailed?}`. Result `counts {targets, with_email, unavailable, already_had_email, skipped_fresh}`.
- **Retry** (T6): `POST /api/jobs/:id/retry` → 400 `{error, code:'blocked', blockers}` quando i blocker di
  configurazione del kind sono attivi (tutti i kind).

### 12-bis. Contratto effettivo dopo wave F (2026-09-17) — prevale su §12 dove diverge

- **Aziende (T4b)**: `POST /api/companies {linkedin_url?, website?, name?, …}` → 201 | 400 `company_keys_missing` | 400
  `invalid_company_url` | 409 `{code:'company_exists', company_id, company_name, key:'linkedin_url'|'domain'}`;
  `PATCH` idem (`''`/`null` toglie una chiave); `POST /api/companies/from-url {url, icpId?, outcome?}` trova-o-crea
  (201 creata / 200 esistente, mai 409); `GET …/:id/merge/preview?into=` → `{loses:{domain?, linkedin_url?, notes?},
  absorbed:{references, candidates, prospects, sources}}`; `POST …/:id/merge {into}` → 200 `{company}` | 400
  `merge_same_company` | 404; risposte senza `apollo_json`; blocker sourcing `NO_LINKEDIN_BLOCKER`.
- **Arricchimento aziende (T7c)**: preview → `counts {references, with_domain, to_enrich, skipped_fresh, enriched,
  est_credits}`, `items[] {company_id, name, domain, state: da_arricchire|arricchita|non_trovata|in_conflitto|senza_sito,
  apollo_enriched_at, to_enrich, label}`; start 202 | 400 `blocked` (anche blocker di dato) | 404 | 409. Core
  riusabile `enrichCompanies(companyIds, deps, {now, retryNotFound})`.
- **Ricerca (T7a)**: `GET …/lookalike/preview?pages=&perPage=25|50|100&restart=1&custom=1&keywords=a&keywords=b&ranges=21-50&locations=…`
  (senza `custom` = filtri derivati; con `custom=1` valgono esattamente i parametri ripetuti) → `{counts {pages,
  per_page, start_page, est_credits, requests}, est_cost_usd, warnings, blockers, filters {keywords, ranges, locations,
  origins {keywords, ranges, locations}, notes, custom, derived}, resume {run_id, last_run_at, per_page, last_page,
  last_page_declared, next_page|null, exhausted, restart} | null, references [{company_id, name, domain, linkedin_url,
  status: enriched|to_enrich|not_found|key_conflict|no_domain, enriched_at, attempted_at}]}`; `GET …/lookalike/runs` →
  `{items [{id, at, state, pages, per_page, start_page, filters, counts, warnings, stats}]}`; `POST …/lookalike {pages,
  perPage?, keywords, ranges, locations, restart?, autoContacts?}` → 202 | 400 `blocked` | 400 `pipeline_unavailable`
  (fino a T9) | 409 | 404.
- **Candidate (T11)**: `GET …/candidates?status=` → `{items [CandidateRow + apollo_city/state/country/employees],
  total (ignora il tetto 500), counts, last_run}`; `PATCH …/candidates/:companyId {status}` → candidata; `POST
  …/candidates/bulk {company_ids, status}` → `{updated, failed}`; `GET /api/companies/:id/candidate-of`, `GET
  /api/companies/:id/contacts-at?listId=`; la PUT della referenza restituisce anche `candidate_removed`.
- **Contatti (T8, S-6)**: `GET …/contacts/preview?companyIds=1,2&listId=&roles=a&roles=b&seniorities=vp,head&locations=…&perCompany=`
  (`roles`/`locations` solo come chiavi ripetute; chiave assente = default dell'ICP; `roles=` vuoto = nessun ruolo) →
  `counts {companies, with_domain, without_domain, per_company, requests, est_credits}` con `est_credits = with_domain ×
  perCompany`; `POST …/contacts {companyIds, listId, roles?, seniorities?, locations?, perCompany?}` → 202 | 400
  `blocked` | 409 | 404. Result `counts {people_read, people_matched, companies_done, companies, without_domain, added,
  prospects_new, prospects_seen, already_in_list, skipped_no_url, apollo_id_taken, with_email, credits_used, requests}`.
- **Enrich (T10)**: `provider=apify|apollo` in query/body; Apollo preview `counts {selected, targets, skipped_with_email,
  skipped_fresh, not_found, est_credits}`; result `counts {selected, targets, with_email, unavailable, already_had_email,
  skipped_fresh, not_found, not_searched, apollo_id_taken, credits_used}`.
- **Dopo `$simplify` (2026-09-17)**: la preview di arricchimento (entrambi i provider) espone anche `unit_prices {apify,
  apollo}` (prezzi configurati, `null` se assenti) e il dialog non fa più una seconda preview per ricavarli;
  `GET /api/icps/:id`, `POST`/`PATCH /api/icps/:id` e `PUT …/reference-companies/:companyId` rispondono senza
  `apollo_json` (come le route aziende; chiude AL-TD-11). Blocker di avvio: un solo `preview.blockers` per piano
  (`startBlockers` / `runningBlocker` rimossi), 400 `blocked` via `launchUnlessBlocked` in `src/server/jobs.ts`.
  `migrateCompaniesDualKey` (T4a) è stata rimossa: la migrazione passa solo da `migrateSchema`.
- **Dopo l'audit dei criteri (2026-09-17)**: `est_cost_usd` è `null` senza prezzo configurato **anche a 0
  crediti/target** (C5/G3: mai "$0,00" senza prezzo); con `provider=apollo` il blocker della lista archiviata usa
  il testo del flusso contatti (`archivedListText`); il warning parziale di `enrich_companies` distingue
  "arricchite" da "elaborate … (N arricchite)" quando le salvate includono non trovate o conflitti (C7/AL-TD-7);
  in `apollo_people` un 401/403 dopo ≥ 1 azienda completata è un esito parziale riuscito, non un job fallito
  (F10); `configBlockers` di `enrich`, `enrich_companies` e `lookalike_companies` bloccano "Riprova" su lista o
  ICP cancellati (`ICP_MISSING_BLOCKER` in `src/jobs/types.ts`, chiude AL-TD-4).

## 13. Backlog (story product-facing, `relation_mode: body-links`, nessun tracker esterno)

| Story | Titolo | Criteri SPEC | Task |
|---|---|---|---|
| AL-S1 | Configurazione Apollo e verifica preliminare | A1–A5 | T0, T1, T12a, T17 |
| AL-S2 | Aziende con il dominio come identità | B1–B14, Regole di unione | T2, T4a, T4b, T15 |
| AL-S9 | Arricchimento Apollo delle referenze | C1–C7 | T7c, T12a, T13, T16 |
| AL-S3 | Trova aziende simili con preview e filtri derivati | D1–D13, Regole di somiglianza | T2, T3, T5, T7a, T7b, T12a, T13, T16 |
| AL-S4 | Triage delle candidate | E1–E6 | T5, T11, T13 |
| AL-S5 | Trova contatti nelle aziende accettate | F1–F11 | T8, T13, T14, T16 |
| AL-S6 | Email di lavoro via Apollo | G1–G7 | T10, T14, T16 |
| AL-S7 | Pipeline opt-in | H1–H4 | T9, T13 |
| AL-S8 | Coerenza job: retry con blocker, fake e2e, documentazione | I1–I3, Constraints | T6, T16, T17, T18 |

## 14. Task

### T0: Base git + script di smoke reale Apollo

- **depends_on**: []
- **location**: repo root, `scripts/apollo-smoke.ts`, `package.json`, `tests/fixtures/apollo/`
- **description**: (1) Esegui i 4 gate sullo stato attuale; commit su `main` dello stato corrente
  (messaggio "crm-foundation: stato al 2026-09-16 (review DO NOT SHIP, TD aperti)") e branch
  `apollo-lookalike`. (2) Script `npm run apollo:smoke -- --domain acme.it --linkedin https://www.linkedin.com/in/<slug>`
  (`tsx scripts/apollo-smoke.ts`): legge `APOLLO_API_KEY` dal `.env`, **rifiuta di partire senza `--yes`**
  stampando prima il costo atteso (≈ 3 crediti); esegue una chiamata per operazione (bulk_enrich del
  dominio; mixed_companies/search 1 pagina `per_page=5`; mixed_people/api_search `per_page=5` sul dominio;
  people/match sull'URL); stampa status, header `x-rate-limit-*`/`retry-after`, e salva le risposte in
  `tests/fixtures/apollo/raw/` (gitignored) più una copia **anonimizzata** (nomi, email, URL sostituiti)
  in `tests/fixtures/apollo/*.json` da rivedere a mano. Usa `fetch` diretto: non dipende da T3. Registra
  in §7 ogni scostamento dai fatti assunti (nomi campi, `per_page` massimo, permessi).
- **validation**: `git log -1` mostra il commit di base e `git branch --show-current` = `apollo-lookalike`;
  `npm run apollo:smoke` senza `--yes` esce con codice 2 senza chiamate; con `--yes` e chiave valida stampa
  le 4 righe di esito; `grep -ril "@" tests/fixtures/apollo/*.json` non trova email reali;
  `git check-ignore data/crm.db.bak-x` e `tests/fixtures/apollo/raw/x.json` rispondono "ignorato"; **solo
  commit locale, nessun push** (TD-29: dati personali nel repo).
- **status**: Complete
- **log**:
  - 2026-09-17 — Gate di base: typecheck/build/typecheck web verdi; vitest 234/238 (4 falliti preesistenti per `ANALYSIS_MODEL` del `.env` locale, corretti in T1). Commit di base `7a33339` su `main` (solo locale) + branch `apollo-lookalike`.
  - Script `scripts/apollo-smoke.ts` con `main(argv, deps)` iniettabile: senza `--yes` stampa il costo ed esce 2 senza chiamate; con `--yes` 4 POST, raw in `tests/fixtures/apollo/raw/` (gitignored), copia anonimizzata solo su risposta riuscita. Fixture `_source:"docs"`. RED→GREEN `tests/apollo-smoke.test.ts`.
  - Verifica documentazione Apollo (docs.apollo.io, 2026-09-17): People API Search **non** restituisce `linkedin_url`/dominio (cognome offuscato) → decisione utente S-6 (§4); Organization Search: esempio senza `industry/keywords/dipendenti/sede` → smoke reale da eseguire dall'utente prima di T7b. Script riallineato a `requests.ts` (query `domains[]`, `people/bulk_match` per id + URL, ≈ 4 crediti).
  - Allineamento: lo smoke usa i builder di `src/apollo/requests.ts` + `buildApolloUrl`; passo 4 = `people/bulk_match` per id (dalla ricerca) + `linkedin_url`; stampa la copertura dei campi di ricerca aziende, ricerca persone e match. Fixture docs `people-bulk-match.json` (sostituisce `people-match.json`; test mapper aggiornato). RED 8/14 → GREEN 14/14.
  - 2026-09-17 — Smoke reale eseguito dall'utente (≈ 4 crediti, 4/4 HTTP 200, permessi ok): esiti in §7. Copie anonimizzate spostate in `tests/fixtures/apollo/smoke/` (le prime avevano sovrascritto le fixture docs, ripristinate); lo script ora scrive solo lì e maschera indirizzi e headline.
- **files edited/created**: `scripts/apollo-smoke.ts`, `package.json`, `.gitignore`, `tests/fixtures/apollo/*.json` (`people-bulk-match.json` al posto di `people-match.json`), `tests/apollo-smoke.test.ts`, `tests/apollo-mappers.test.ts` (fixture match)
- **backlog_item_id**: AL-S1
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#a-configurazione-e-readiness]]
- **relation_mode**: body-links
- **tdd_target**: RED — `apollo-smoke` senza `--yes` esce con codice 2 e non invoca `fetch` (test con `fetch` iniettato/spy); le chiamate reali restano manuali (SPEC A5).
- **review_mode**: cli

### T1: Config Apollo e readiness

- **depends_on**: [T0]
- **location**: `src/config.ts`, `src/db/settings.ts`, `.env.example`
- **description**: `config.apolloApiKey`, `apolloMaxCompanyPages` (default 3, clamp 1–100),
  `apolloPeoplePerCompany` (default 10, clamp 1–100), `apolloRateLimitPerMinute` (default 200, ≥ 1),
  `prices.apolloCreditUsd` (`optionalFloat`), `requireApollo()`; `Readiness.apollo`; `.env.example`:
  sezione "Apollo" con le 5 variabili commentate e i default; `tests/setup.ts` imposta una chiave fake
  (come per Apify/Anthropic); `scripts/e2e-server.ts`: `APOLLO_API_KEY` finta salvo `E2E_NO_APOLLO=1`
  (stesse due righe di Apify/Anthropic; T16 non tocca più l'env).
- **validation**: `GET /api/settings` → `readiness.apollo` false con chiave vuota, true con chiave;
  default dei clamp; `npm run typecheck` verde.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. `config.apollo*` + `prices.apolloCreditUsd` (clamp `clampedInt`), `requireApollo()`, `Readiness.apollo`; `.env.example` sezione Apollo; e2e `E2E_NO_APOLLO`. RED `readiness.apollo` undefined → GREEN (`api-settings` 8/8).
  - `tests/setup.ts` non legge più il `.env` locale (`DOTENV_CONFIG_PATH=os.devNull`) e fissa i parametri di config: chiude i 4 falliti preesistenti di `analyze.test.ts`.
- **files edited/created**: `src/config.ts`, `src/db/settings.ts`, `.env.example`, `tests/setup.ts`, `scripts/e2e-server.ts` (2 righe env), `tests/api-settings.test.ts`
- **backlog_item_id**: AL-S1
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#a-configurazione-e-readiness]]
- **relation_mode**: body-links
- **tdd_target**: RED — `GET /api/settings` con `config.apolloApiKey=''` risponde `readiness.apollo === false`; con `'k'` → `true`.
- **review_mode**: cli

### T2: Mapper Apollo puri, `normalizeDomain`, regole di somiglianza

- **depends_on**: [T1]
- **location**: `src/apollo/mappers/organizations.ts`, `src/apollo/mappers/people.ts`, `src/apollo/similarity.ts`, `src/util/fields.ts`
- **description**: `normalizeDomain(raw)` (SPEC B2; costante `SHARED_HOSTS` = linkedin.com, facebook.com,
  instagram.com, google.com, sites.google.com, wixsite.com con suffix-match: `acme.wixsite.com` → `undefined`).
  `mapOrganization(item) → {apolloId, name, domain
  (primary_domain → website), website, linkedinUrl, industry, keywords[], employees, country, state, city,
  description, raw}` e `mapOrganizations(items) → {items, declared, recognized}` (item senza id/dominio
  scartati). `mapPerson(item) → {apolloId, fullName, linkedinUrl?, memberUrn?, title, seniority, location,
  companyName, companyDomain, companyLinkedinUrl, email?, raw}`; `mapPeople(items) → {candidates,
  skippedNoUrl}`. `similarity.ts`: `APOLLO_EMPLOYEE_RANGES`, `rangeOf(n)`, `neighbours(range)`,
  `parseIcpSize(text) → [min, max|null] | null`, `normalizeTag`, `deriveFilters(references, icp) →
  {keywords[], ranges[], locations[], origins, notes[]}`, `filtersEqual(a, b)`, `filtersHash(filters)`,
  `scoreCandidate(org, filters, references) → {score, parts: {keywords, size, location|null}, reasons[]}` con
  arrotondamento a 2 decimali: esattamente le Regole della SPEC (località = città 1 / regione 0,5;
  sede assente → `location: null` e somma pesata ÷ somma dei pesi disponibili); costanti esportate
  `SCORE_WEIGHTS`, `TOP_KEYWORDS = 10`, `SCORE_BUCKETS` (0,34 / 0,67), `SCORING_VERSION = 'v1'`, `bucketOf(score)`.
- **validation**: test tabellare con l'esempio della SPEC (Acme/Beta/Gamma: filtro atteso, `score 0.67`, le
  3 ragioni testuali, `parts {keywords 0.333, size 1, location 1}`); Delta (stessa regione) `0.57`; Epsilon
  (sede assente) `0.58` con `location: null` e ragione "località non disponibile da Apollo"; referenze senza
  sede → `location: null` per tutte; `bucketOf` ai bordi (0.33 basso, 0.34 medio, 0.67 alto); tie-break alfabetico; ICP oltre le 10; 0 parole chiave → 0; candidata senza tag → 0;
  `"10-50"` → `1-10, 11-20, 21-50`; `"50+"` → da `21-50`; `filtersEqual` insensibile a ordine/maiuscole;
  `mapOrganizations` con 5 dichiarate e 4 riconosciute; `normalizeDomain('https://www.Acme.it/x?y') ===
  'acme.it'`, `'shop.acme.it'` resta, `'linkedin.com/company/x'` → `undefined`.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. `normalizeDomain` + `SHARED_HOSTS`; mapper organizzazioni (`organizations[]` + `accounts[]`, campi descrittivi opzionali), mapper persone per le due forme (api_search senza URL/cognome offuscato e bulk_match), `similarity.ts` regole v1 (esempio SPEC: Gamma 0,67 · Delta 0,57 · Epsilon 0,58). RED→GREEN `apollo-similarity` (22) + `apollo-mappers` (16).
  - Scelte: `origins` annidato per tipo di filtro (`{keywords, ranges, locations}` → valore → origini; §12 va letto così); `parts.keywords` a 3 decimali, `score` calcolato dalle parti non arrotondate; ragione al singolare con 1 parola chiave.
  - Dopo lo smoke: fixture docs ripristinate + blocco di test "forme reali" su `smoke/*.json` (ricerca senza descrittivi → punteggio 0; persone senza URL; `bulk_match` può ripetere la stessa persona). Nessun bug dei mapper.
- **files edited/created**: `src/apollo/mappers/organizations.ts`, `src/apollo/mappers/people.ts`, `src/apollo/similarity.ts`, `src/util/fields.ts`, `tests/apollo-mappers.test.ts`, `tests/apollo-similarity.test.ts`, `tests/fixtures/apollo/*.json` (se T0 non le ha prodotte: dalla documentazione, `"_source": "docs"`)
- **backlog_item_id**: AL-S3
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#regole-di-somiglianza-v1-deterministiche]]
- **relation_mode**: body-links
- **tdd_target**: RED — l'esempio della SPEC produce `score 0.67` e le tre ragioni nell'ordine parole chiave → dimensione → località; Epsilon senza sede produce `0.58` e `parts.location === null`.
- **review_mode**: cli

### T3: Client Apollo e richieste (unico punto dei body)

- **depends_on**: [T1]
- **location**: `src/apollo/client.ts`, `src/apollo/requests.ts`
- **description**: `createApolloClient({apiKey, fetch?, sleep?})` con `post(op, path, body)`: header
  `x-api-key`; 429 → attende `retry-after` (≤ `APOLLO_RETRY_MAX_WAIT_MS` 60 s) fino a 3 tentativi poi
  `ApolloRateLimitError` (`actor:apollo:<op>: limite di richieste raggiunto`); 401 → `config: chiave Apollo
  rifiutata (401). Verifica APOLLO_API_KEY nel .env.`; 403 → `config: la chiave Apollo non ha i permessi per
  <op>: usa una master key o una chiave con il permesso di ricerca persone (Apollo → Settings → API keys).`;
  altri ≥ 400 e rete → `actor:apollo:<op>: …`; `stats.requests`. `requests.ts`: `APOLLO_SENIORITIES`,
  `enrichOrganizationsRequest(domains ≤ 10)`, `searchOrganizationsRequest(filters, page, perPage)`,
  `searchPeopleRequest({domain, titles, seniorities, locations, perPage})` (una azienda per richiesta,
  P-6), `matchPeopleRequest(details ≤ 10)` con `reveal_personal_emails:false`, `reveal_phone_number:false`;
  `chunk(list, 10)`. Nessuna chiamata a import-time; attesa massima e tentativi sono **costanti** del
  client (non env), documentate nel README (T17); il client non logga mai `x-api-key` né i body (dati
  personali).
- **validation**: `fetch` fake: 429(`retry-after:0`)→200 riesce con `stats.requests=2`; 4×429 → errore
  `actor:apollo:mixed_companies/search: limite…`; 403 → `config:` con "master key"; body = snapshot.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. `requests.ts` unico punto di path/body (`bulk_enrich` con query `domains[]`; fasce `A-B` → `"A,B"`, `N+` → `"N,1000000"`); `client.ts#post(request)` con 3 tentativi totali sul 429 (attesa `retry-after` ≤ 60 s, 5 s senza header), timeout 30 s, errori `ApolloConfigError`/`ApolloRateLimitError`/`ApolloProviderError`, chiave mai nei messaggi. RED 403 → `config:` "master key" → GREEN (`apollo-client` 20/20).
  - Dopo lo smoke: ritmo per endpoint dagli header `x-*-requests-left` (minuto a 0 → attesa della finestra; ora/giorno a 0 → `ApolloRateLimitError` immediato con `window`), `client.limits(op)`, `now` iniettabile. RED 5 → GREEN 25/25.
- **files edited/created**: `src/apollo/client.ts`, `src/apollo/requests.ts`, `tests/apollo-client.test.ts`
- **backlog_item_id**: AL-S3
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#constraints]]
- **relation_mode**: body-links
- **tdd_target**: RED — `client.post('mixed_people/api_search', …)` con fetch 403 rigetta con `config:` e "master key".
- **review_mode**: cli

### T4a: Identità azienda a doppia chiave (schema, migrazione con backup, upsert/merge)

- **depends_on**: [T2]
- **location**: `src/db/schema.ts`, `src/db/index.ts`, `src/db/companies.ts`, `src/db/company-identity.ts`
- **description**: `schema.ts`: DDL nuova di `companies` (§6) + indici; `rebuildTable(db, name, ddl,
  columns)` generico (`foreign_keys=OFF` fuori transazione → transazione: create `<name>__new`,
  insert-select, drop, rename, indici → `foreign_key_check` vuoto → ON; errore → rollback e rethrow con il percorso del backup nel messaggio);
  `backupDatabase(db, dbPath)` una sola volta per avvio (`VACUUM INTO dbPath + '.bak-<ISO>'`: copia
  consistente anche in WAL, percorso come parametro bound; `hasBackedUp` in memoria; rifiuta con errore
  se sull'handle ricevuto `SELECT pid FROM jobs WHERE state='running'` ha un pid vivo — `isAlive(pid)` va in
  `src/util/process.ts`, nuovo, riusato da `server/jobs.ts` in T6); `migrateCompaniesDualKey(db, dbPath)`: solo se
  `PRAGMA table_info(companies)` dice `linkedin_url.notnull=1` → backup → rebuild → backfill `domain` da
  `website` con `normalizeDomain` in ordine di id, saltando le collisioni con `console.warn`; `applySchema`
  la chiama (DB nuovi: no-op). `companies.ts`: `Company.domain/apollo_org_id/apollo_json/apollo_enriched_at`;
  `CompanyInput.website` → `domain` derivato, `linkedin_url` opzionale; `findCompanyByDomain`,
  `findCompanyByApolloId`; `createCompany` (nome default: slug o dominio; nessuna chiave → throw);
  `updateCompany` mantiene "almeno una" (throw `CompanyKeysError`); `listCompanies` filtra anche `domain`;
  `upsertCompany(input, {refresh?}) → {id, created, mergedIds, linkedinAcquired, keyConflict}` (P-2 + Regole
  di unione: risolve per URL, per dominio, per `apollo_org_id`; "chiave in conflitto" = una chiave
  dell'input trova una riga la cui altra chiave è piena e diversa → nessuna scrittura, `keyConflict:true`;
  relazioni in conflitto secondo la SPEC: referenza vince su candidatura, stato deciso vince su `proposta`);
  `updateCompany` che cambia `domain` o `linkedin_url` azzera `apollo_enriched_at`/`apollo_org_id`/`apollo_json`;
  `mergeCompanies` fonde le fonti duplicate `(prospect, kind)` tenendo la più recente; dati Apollo con COALESCE sui campi descrittivi (SPEC
  C3) e sovrascrittura di `apollo_*`. `company-identity.ts`: `mergeCompanies(keepId, dropId)` in
  transazione (Regole di unione; `icp_company_candidates` gestita solo se la tabella esiste: `hasTable`).
- **validation**: migrazione su DB temporaneo con schema vecchio + righe + FK: colonne nuove, conteggi
  identici, `foreign_key_check` vuoto, backup presente e leggibile, seconda `applySchema` senza nuovo
  backup; collisione di dominio → id minore lo tiene, warning; upsert per dominio poi per URL+dominio →
  stessa riga; due righe (solo URL / solo dominio) + Apollo con entrambe → `mergedIds=[drop]`, riferimenti,
  candidature (se presenti), prospect e fonti riassegnati, superstite = chi ha l'URL; chiavi piene in
  conflitto → `keyConflict`, nessuna modifica; `createCompany({})` → throw.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. Doppia chiave `companies` (URL | dominio), migrazione con `rebuildTable` generico + backup `VACUUM INTO` (`<db>.bak-<ISO>`, uno per processo, rifiutato con job vivo), backfill del dominio dal sito (id minore vince, `console.warn`), tutto-o-niente e idempotente; `upsertCompany` con Regole di unione (conflitto / unione / acquisizione / C3) e `mergeCompanies` (referenze, candidate se la tabella esiste, prospect, fonti). RED `no such column: domain` → GREEN; vitest 338/338, typecheck verde.
  - Scelte: `foreign_key_check` blocca solo violazioni introdotte dalla ricostruzione; `updateCompany` ricalcola il dominio solo se `website` cambia davvero e azzera `apollo_*` a ogni cambio di chiave; in unione un'organizzazione trovata batte un tentativo "non trovata" più recente. Fuori scope: guard `config:` su URL nullo in `source-company.ts`; fixture `tests/fixtures/schema-crm-foundation.sql` (schema vecchio per i test di migrazione).
- **files edited/created**: `src/db/schema.ts`, `src/db/index.ts`, `src/db/companies.ts`, `src/db/company-identity.ts`, `src/util/process.ts`, `src/jobs/source-company.ts` (guard URL nullo), `tests/company-identity.test.ts`, `tests/schema.test.ts`, `tests/fixtures/schema-crm-foundation.sql`
- **backlog_item_id**: AL-S2
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#regole-di-unione-aziende]]
- **relation_mode**: body-links
- **tdd_target**: RED — `applySchema` su un DB con `companies.linkedin_url NOT NULL` e 3 righe produce `domain` da `website`, 3 righe, un backup, e `createCompany({website:'beta.io'})` riesce.
- **review_mode**: cli

### T4b: Route aziende: crea da dominio, 409 `company_exists`, PATCH chiavi, merge, blocker sourcing

- **depends_on**: [T5]
- **location**: `src/server/routes/companies.ts`
- **description**: `POST /api/companies` e `/companies/from-url` accettano URL LinkedIn **o** sito/dominio
  (nessuno → 400); chiave già altrui → 409 `{code:'company_exists', company_id, company_name}`; `PATCH` con
  `linkedin_url`/`website` e "almeno una" (400); `GET /api/companies/:id/merge/preview?into=` → `{loses: {domain?, linkedin_url?, notes?}, absorbed:
  {references, candidates, prospects, sources}}` e `POST /api/companies/:id/merge {into}` → 200 `{company}`
  (404/400); `GET /api/companies?q=` per dominio; dettaglio con `domain`, `apollo_*`; sourcing: blocker
  "Azienda senza pagina LinkedIn: recuperala prima (Anagrafica → URL LinkedIn)." in preview e avvio (anche
  in `source-company.ts#configBlockers` quando T6 lo introdurrà: qui solo la route).
- **validation**: `POST {website:'https://www.acme.it'}` → 201 `domain:'acme.it'`, `name:'acme.it'`,
  `linkedin_url:null`; ripetuto → 409 con `company_id`; `PATCH` che svuota entrambe → 400; `merge`
  riassegna, drop → 404; preview sourcing su solo-dominio → blocker, `POST …/source` → 400 `blocked`.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. `routes/companies.ts`: creazione e PATCH su entrambe le chiavi con 400 `company_keys_missing` e 409 `company_exists {company_id, company_name, key}` senza scritture; `from-url` accetta anche sito/dominio e resta trova-o-crea (200 se esiste: serve alle referenze dell'ICP); `GET …/merge/preview?into=` + `POST …/merge {into}` (superstite = `into`); blocker sourcing senza URL (`NO_LINKEDIN_BLOCKER`) in preview e 400 `blocked`; `apollo_json` escluso dalle risposte. RED 400 → 201/409, RED blocker `[]` → testo; `api-companies` 8/8, `source-company` 13/13.
  - Scelte: codici nuovi `merge_same_company`, `merge_target_missing`; l'unione non è bloccata da un job in corso. FE da riallineare in T12/T15 (`duplicate`/`existing_id` → `company_exists`/`company_id`, `linkedin_url` nullable).
- **files edited/created**: `src/server/routes/companies.ts`, `tests/api-companies.test.ts`, `tests/source-company.test.ts`
- **backlog_item_id**: AL-S2
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#b-identità-azienda-a-doppia-chiave]]
- **relation_mode**: body-links
- **tdd_target**: RED — `POST /api/companies {website:'acme.it'}` → 201 con `domain:'acme.it'`; ripetuto → 409 `code:'company_exists'`.
- **review_mode**: cli

### T5: Schema candidate, colonne Apollo dei prospect, tre job kind, stub, pre-cablaggio, contratto params/result

- **depends_on**: [T4a, T3]
- **location**: `src/db/schema.ts`, `src/db/candidates.ts`, `src/db/prospects.ts`, `src/jobs/types.ts`, `src/jobs/handlers.ts`, `src/jobs/fake-deps.ts`, `src/server/app.ts`, `src/server/jobs.ts`
- **description**: `schema.ts`: `CANDIDATE_STATUSES`, tabella `icp_company_candidates` (§6, cascade su ICP e
  azienda), `SOURCE_KINDS + 'apollo_people'` + CHECK, `ensureColumn(prospects, apollo_person_id)`,
  `apollo_matched_at`, indice unico parziale; ricostruzione di `sources` e `jobs` con `rebuildTable` quando il
  loro `sql` in `sqlite_master` non contiene i nuovi valori (stesso `backupDatabase`). `types.ts`: `JOB_KINDS +
  'enrich_companies', 'lookalike_companies', 'apollo_people'`; **contratto JSON** documentato in commento:
  `params` e `result.counts` di ogni nuovo kind come in §12 (letti da preview, card, storico, "Riusa questi
  filtri"). `prospects.ts`: `ProspectInput.apolloPersonId?` scritto solo se libero (`upsertProspect` ritorna
  `apolloIdTaken`), `SourceInput` accetta `apollo_people`; `identity.ts`: `apollo_person_id` e
  `apollo_matched_at` in `FILL_COLUMNS` di `mergeProspects` (SPEC F6/G6). `candidates.ts`: `upsertCandidate` (non tocca lo
  stato di una esistente), `listCandidates(icpId, status?)` con `last_contacts_at` (P-4), `countCandidates`,
  `setCandidateStatus(icpId, ids[], status) → {updated, failed[]}` per item, `removeCandidate`,
  `candidateOf(companyId)`, `knownCompanyIdsForIcp`, `lastLookalikeRun(icpId)`, `lookalikeRuns(icpId, 5)`
  (ciascuna con `stats` da `runStats(jobId)`: `proposed`, `without_location` (`score_parts.location IS NULL`),
  `buckets` fascia × stato con le soglie di `SCORE_BUCKETS`; SPEC D14), `upsertCandidate` scrive `score_parts`
  e `scoring_version`,
  `lastContactsByCompany(companyIds, listId?)` (da `sources` `apollo_people`, `MAX(captured_at)`; con `listId` solo su prospect membri della lista: warning F3 di T8). Stub: `jobs/enrich-companies.ts`, `jobs/lookalike-companies.ts`,
  `jobs/apollo-people.ts` (`Deps`, `handler` → `NotImplementedError`, `realDeps`, `configBlockers` → `[]`);
  `handlers.ts`: `HANDLERS`, `DepsByKind`, `REAL_DEPS` + registry `CONFIG_BLOCKERS` (kind esistenti → `[]`
  finché T6); `fake-deps.ts`: stub per i 3 kind; `app.ts`: monta `enrichCompaniesRoutes`, `lookalikeRoutes`,
  `contactsRoutes`, `candidatesRoutes` (stub 501); `server/jobs.ts`: `JOB_KIND_LABELS` dei 3 kind (P-16). Lo stub di `lookalike-companies.ts` dichiara già il
  `Deps` **definitivo** (`searchOrganizations` + `searchPeople` per la pipeline) così T16 simula la forma finale.
- **validation**: `schema.test.ts`: tabella, CHECK (`score_parts` JSON valido), kind nuovi inseribili, `apollo_people` senza `company_id`
  rifiutata; DB vecchio → ricostruito con righe intatte; `candidates.test.ts`: API dati, `runStats` con 5
  candidate di due job (una senza località, una accettata) → fasce e stati attesi, job senza candidate →
  zeri; app monta le 4
  route (501); `tests/company-identity.test.ts` esteso con le relazioni in conflitto dell'unione
  (referenza vince su candidatura; `accettata`/`scartata` vince su `proposta`; a parità il superstite); gate verdi.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. Tabella `icp_company_candidates` + API dati `src/db/candidates.ts` (upsert che non tocca le esistenti né punteggio/ragioni, stato per item, `runStats` fascia × stato, `lookalikeRuns`, `lastContactsByCompany`), `SOURCE_KINDS + apollo_people`, 3 job kind, colonne Apollo dei prospect (`apolloIdTaken`), migrazione unica `migrateSchema` (companies + sources + jobs + colonne prospects: un backup, una transazione), 3 job stub con `Deps` definitive (JSON grezzo mappato negli handler), `CONFIG_BLOCKERS`, 4 router stub 501. RED `Cannot find module candidates.js` → GREEN; vitest 392/392, typecheck verde.
  - Notati: `src/analysis/prompt.ts#sourceLine` senza caso `apollo_people` (assegnato a T8); `addSource` conserva il primo `captured_at` (T8 decide per "già cercata il <data>").
- **files edited/created**: `src/db/schema.ts`, `src/db/candidates.ts`, `src/db/prospects.ts`, `src/db/identity.ts`, `src/jobs/types.ts`, `src/jobs/handlers.ts`, `src/jobs/fake-deps.ts`, `src/jobs/{enrich-companies,lookalike-companies,apollo-people}.ts`, `src/server/app.ts`, `src/server/jobs.ts`, `src/server/routes/{enrich-companies,lookalike,contacts,candidates}.ts`, `tests/schema.test.ts`, `tests/candidates.test.ts`, `tests/app-skeleton.test.ts`, `tests/prospect-identity.test.ts`, `tests/api-prospects.test.ts`
- **backlog_item_id**: AL-S4
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#data-model-delta-livello-di-dominio]]
- **relation_mode**: body-links
- **tdd_target**: RED — `upsertCandidate` due volte dopo `setCandidateStatus(…,'accettata')` lascia `accettata`; `setCandidateStatus` con un id inesistente ritorna `failed:[{company_id}]` e aggiorna gli altri.
- **review_mode**: cli

### T7a: Preview della ricerca lookalike, storico ricerche, route (senza job)

- **depends_on**: [T5]
- **location**: `src/jobs/lookalike-companies.ts`, `src/server/routes/lookalike.ts`
- **description**: `LookalikeParams {icpId, pages, startPage, keywords[], ranges[], locations[], filtersHash,
  autoContacts: null}`; `planLookalike(icpId, input)` → `{preview, params, filters, resume, references}`:
  referenze con dominio e stato di arricchimento, `deriveFilters` (T2) con override dall'input, `resume` da
  `lastLookalikeRun` (`filtersEqual` → `startPage = last_page + 1`, solo se `last_page_declared === 100`;
  altrimenti "ricerca esaurita"; `restart` → 1), `counts {pages, est_credits, requests}`, `est_cost_usd`,
  warning (D5, incluso "nessuna referenza arricchita"), blocker (D4) via `configBlockers(params)` (chiave,
  filtri vuoti) + `runningJobBlocker`. Route: `GET …/lookalike/preview`,
  `GET …/lookalike/runs` (P-4; ogni riga con `stats` di `runStats`, SPEC D14), `POST …/lookalike` che valida,
  ricalcola i blocker e lancia il job (l'handler è ancora lo stub: il test di avvio verifica solo 202/400/409).
- **validation**: preview con 2 referenze (1 arricchita) → filtri dall'esempio SPEC, warning "non
  arricchita", `est_credits 1`; senza chiave → blocker; ICP senza settori e referenze non arricchite →
  blocker "filtri vuoti"; job precedente riuscito con stessi filtri (`jobs` seminata) → `resume.next_page 2`;
  `restart=1` → 1; `runs` → ultimi 5 con `stats` (job seminato con 3 candidate: 2 basso scartate, 1 alto accettata, 1 senza località).
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. `planLookalike`: referenze con stato Apollo (`enriched | to_enrich | not_found | key_conflict | no_domain`), filtri derivati dalle referenze arricchite + ICP oppure quelli dell'utente con `custom=1` (parametri ripetuti), ripartenza solo con stessi filtri **e** stessa dimensione di pagina e ultima pagina piena, `est_credits = pagine + pagine × perPage` (S-7), `requests = pagine + ⌈pagine × perPage / 10⌉`. Route preview / runs (con `stats`) / POST → 202, 400 `blocked`, 400 `pipeline_unavailable` (fino a T9), 409, 404. `Deps.enrichOrganizations`, `LookalikeParams.perPage`, `LookalikeCounts.enriched`. RED 501 → GREEN 16/16.
  - Scelte: ricerca esaurita = warning (si riparte da pagina 1), non blocker; il blocker "job in corso" lo aggiunge la route; copy in più rispetto al FLOW per referenze non trovate / in conflitto, dimensione di pagina diversa e limite di richieste.
- **files edited/created**: `src/jobs/lookalike-companies.ts`, `src/server/routes/lookalike.ts`, `src/jobs/types.ts` (blocco Lookalike), `tests/lookalike-preview.test.ts`
- **backlog_item_id**: AL-S3
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#d-trova-aziende-simili-preview--job]]
- **relation_mode**: body-links
- **tdd_target**: RED — `GET /api/icps/:id/lookalike/preview` per l'ICP dell'esempio SPEC risponde con `filters.keywords` attesi e `counts.est_credits === 1`.
- **review_mode**: cli

### T7c: Job `enrich_companies` (referenze dell'ICP o singola azienda) + preview e route

- **depends_on**: [T5]
- **location**: `src/jobs/enrich-companies.ts`, `src/server/routes/enrich-companies.ts`
- **description**: `EnrichCompaniesParams {companyIds[], icpId?}`; `Deps {enrichOrganizations(domains) →
  raw[]}`; `planEnrichCompanies(scope)` → preview (`counts {references, with_domain, to_enrich, skipped_fresh,
  est_credits}`, warning referenze senza dominio, blocker chiave / nessuna da arricchire / job in corso);
  preview con opzione `retryNotFound` (SPEC C2); `to_enrich` = dominio presente AND `apollo_org_id IS NULL`
  AND (`apollo_enriched_at IS NULL` OR più vecchia di `FRESHNESS_DAYS` OR `retryNotFound`): le referenze
  trovate non si ripagano mai; handler: verifica config in cima; `chunk(10)` → `mapOrganizations` → per
  organizzazione `upsertCompany` (Regole di unione: `merged`, `linkedin_acquired`, `key_conflicts`); aziende
  senza esito → `apollo_enriched_at = now`, `apollo_org_id = null`, `apollo_json = {outcome:'not_found'}`
  (`not_found`); referenza in conflitto di chiavi → stessa marcatura con `{outcome:'key_conflict',
  apollo_keys}` e chiavi discordanti nel warning (`key_conflicts`, SPEC C3); ogni lotto in transazione,
  un lotto in errore non ferma gli altri (SPEC C7); errore dopo ≥ 1 referenza salvata → parziale riuscito,
  prima → `failed`; `summary` FLOW A.1b. Route: `GET/POST /api/icps/:id/enrich-companies[/preview]` e
  `GET/POST /api/companies/:id/enrich-apollo[/preview]`.
- **validation**: 3 referenze (2 con dominio, 1 arricchita ieri) → preview `to_enrich 1`; job con fixture
  → `enriched 1`, dati Apollo salvati senza sovrascrivere `industry` esistente, `linkedin_acquired 1`;
  organizzazione con URL di un'altra azienda solo-LinkedIn → `merged 1`; dominio non trovato →
  `not_found 1` e `apollo_enriched_at` valorizzato; secondo run → `to_enrich 0`; singola azienda dal
  dettaglio → 202.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. Core riusabile `enrichCompanies(companyIds, deps, {now, retryNotFound})` (lotti da 10; salta inesistenti/già arricchite/senza dominio/tentate di recente senza chiamare Apollo; abbinamento dominio → URL LinkedIn → unico avanzo del lotto; marcatura `not_found`/`key_conflict`; transazione e isolamento per lotto; stop su `config:` e limite orario/giornaliero), handler con esito parziale, `planEnrichCompanies` con `items` per il dialog, 4 route (ICP e singola azienda). RED `NotImplementedError` → GREEN 11/11.
  - Scelte: `credits_used` = organizzazioni restituite; i blocker di dato (nulla da arricchire, già arricchita, serve il sito) rispondono 400 `blocked` anche all'avvio; `size` salvato come "N dipendenti", `location` "città, regione, paese" (solo se vuoti).
- **files edited/created**: `src/jobs/enrich-companies.ts`, `src/server/routes/enrich-companies.ts`, `tests/enrich-companies.test.ts`
- **backlog_item_id**: AL-S9
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#c-arricchimento-apollo-delle-aziende-referenze]]
- **relation_mode**: body-links
- **tdd_target**: RED — `enrichCompanies({companyIds:[beta]}, fakeDeps)` salva `apollo_org_id`, `keywords` in `apollo_json`, `apollo_enriched_at` e ritorna `counts.enriched === 1`.
- **review_mode**: cli

### T8: Job `apollo_people` + preview e avvio contatti

- **depends_on**: [T5]
- **location**: `src/jobs/apollo-people.ts`, `src/server/routes/contacts.ts`, `src/exports/list-export.ts`
- **description**: `ApolloPeopleParams {icpId, companyIds[], listId, roles[], seniorities[], locations[],
  perCompany}`; `Deps {searchPeople(request) → {items, pagination}}`. `planContacts` → preview (§12), warning
  (senza dominio escluse; già cercate per la lista con data = fonte `apollo_people` dell'azienda su un membro della lista; richieste > rate limit), blocker F3 via `configBlockers`;
  warning "nessun ruolo: prime N persone qualunque" (come il sourcing). Handler esportato anche come
  `runApolloPeople(params, deps, ctx)` per T9: verifica lista/config in cima; **una richiesta per azienda**
  (P-6); `mapPeople`; per persona con URL → `upsertProspect` (`memberUrn` se l'URL è in forma id, `companyId`
  per dominio, `title`, `companyName`, `apolloPersonId`) → `addSource({kind:'apollo_people', companyId, raw})`
  → `addMembers`; ogni azienda in transazione; errore dopo ≥ 1 azienda → parziale riuscito; conteggi §12;
  warning > 50 % senza URL; `summary` FLOW C.3. `list-export.ts#sourcesText`: `apollo_people` → "Apollo ·
  <azienda>".
- **validation**: 2 aziende, 6 persone (1 senza URL, 1 con id Apollo già di un altro prospect, 1 già in
  lista) → conteggi attesi incl. `apollo_id_taken 1`, `requests 2`; secondo run → `added 0`, fonti non
  duplicate; rate limit alla 2ª azienda → `succeeded` parziale `companies_done 1`; preview senza ruoli →
  **warning** "L'ICP non ha ruoli target: verranno prese le prime N persone qualunque per azienda" e
  nessun blocker (SPEC F3); export contiene "Apollo · Acme".
- **status**: Complete
- **log**:
  - 2026-09-17 — Done (S-6). `apollo_people` = una ricerca gratuita per azienda + `bulk_match` per id a lotti da 10 allineati per posizione; per persona rivelata con URL: `upsertProspect` (titolo/azienda/`company_id` solo se mancanti, `apolloPersonId` se libero), email se mancante + `apollo_matched_at`, fonte `apollo_people` con `captured_at` aggiornato (`addSource({refreshCapturedAt})`, SPEC E5), membership; una transazione per azienda; errore prima della prima azienda completata → job fallito attribuito, dopo → parziale. Preview `est_credits = aziende con dominio × tetto`, `requests = aziende + ⌈aziende × tetto / 10⌉`, warning F3 + "già cercate … il match si ripaga" + limite di richieste; blocker F3 (lista di un altro ICP inclusa). Export per T9: `runApolloPeople`, `contactsEstimate`, `resolveContactsOptions`, `listBlockers`, `ContactsOptionsBody`. "Apollo · <azienda>" in export CSV e prompt di analisi. RED `NotImplementedError` → GREEN (`apollo-people` 14).
  - Scelte: `roles`/`locations` in query solo come chiavi ripetute (i valori possono contenere virgole), chiave assente = default dell'ICP; testo del blocker chiave dal FLOW Error paths ("… — nessun job avviato."); suggerimento dell'esito zero limitato ai filtri usati.
  - 2026-09-17 — Follow-up (AL-TD-5 chiuso): `runApolloPeople` lancia `ApolloPeopleError {counts, detail}`; l'errore del job dichiara "N crediti usati" e la pipeline riporta i conteggi parziali in `contacts_*` e nel warning. Costante unica `APOLLO_KEY_BLOCKER` in `src/config.ts` (vecchi nomi alias per `tests/jobs.test.ts`). RED 2 → GREEN; vitest 502/502.
- **files edited/created**: `src/jobs/apollo-people.ts`, `src/server/routes/contacts.ts`, `src/db/prospects.ts` (`refreshCapturedAt`), `src/jobs/types.ts` (commenti ApolloPeople), `src/exports/list-export.ts`, `src/analysis/prompt.ts`, `tests/apollo-people.test.ts`, `tests/list-export.test.ts`, `tests/analysis-prompt.test.ts`
- **backlog_item_id**: AL-S5
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#f-trova-contatti-preview--job]]
- **relation_mode**: body-links
- **tdd_target**: RED — `apolloPeople({companyIds:[acme], listId, …}, fakeDeps)` aggiunge alla lista i prospect con URL e ritorna `counts.skipped_no_url === 1` e `counts.requests === 1`.
- **review_mode**: cli

### T10: Enrichment con `provider: 'apollo'` (email di lavoro)

- **depends_on**: [T5]
- **location**: `src/jobs/enrich.ts`, `src/server/routes/enrich.ts`, `src/enrich/apollo-match.ts`
- **description**: `EnrichParams.provider` (default `apify`, sempre esplicito nei params). Con `apollo`:
  `planEnrichment` (P-7), `estimateEnrichCostUsd(targets, provider)`, `Deps.matchPeople(details)` (bulk 10);
  `apollo-match.ts#applyApolloMatch(id, person|undefined)`: `email`/`title`/`company_name` se mancanti,
  `apollo_person_id` se libero, **sempre** `apollo_matched_at` a risposta ricevuta, mai `enriched_at`/
  `enrichment_attempted_at`; attività `enrichment` con `meta {provider:'apollo', outcome, with_email}` e
  testi FLOW D.3; errore del provider su un lotto → i prospect del lotto restano senza `apollo_matched_at`
  ("da cercare"), esito parziale riuscito se ≥ 1 lotto è passato. `configBlockers(params)` (chiave Apollo
  quando `provider==='apollo'`, lista archiviata, token Apify per `apify`) e, per `apollo`, il blocker
  "Nessun profilo da cercare con queste opzioni" quando `targets === 0` (SPEC G3; per `apify` resta il warning
  attuale, TD-3 fuori ambito). Route: `provider` in query/body
  su tutte le forme.
- **validation**: 4 prospect (2 senza email, 1 con, 1 con `apollo_matched_at` ieri) → preview `targets 1`
  (`retryFailed` → 2); job → `with_email 1, unavailable 1`, `enriched_at` invariato, `apollo_matched_at`
  scritta; preview Apollo con 0 target → `blockers` non vuoto e `POST` → 400 `blocked`; errore del provider sul lotto → `apollo_matched_at` nulla e warning; analisi in bulk continua a
  contare il prospect come "da arricchire"; `provider:'apify'` invariato.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. `EnrichParams.provider` sempre esplicito nei params salvati; con `apollo`: ambito = prospect senza email + freshness su `apollo_matched_at`, lotti da 10 per id Apollo o URL allineati per posizione (`alignMatches`, fallback per id/URL se la lunghezza non torna), `applyApolloMatch` (email/titolo/azienda se mancanti, `apollo_person_id` se libero, sempre `apollo_matched_at`, attività `enrichment` con testi FLOW D.3; mai `enriched_at`), errori isolati per lotto, stop su limite o `config:`, parziale dopo ≥ 1 lotto. `configBlockers` esportato da `enrich.ts`; blocker "Nessun profilo da cercare" nella route. RED targets 2 → GREEN; `enrich-apollo` 24/24, `enrich-prospects` 20/20.
  - Scelte: `Deps.matchPeople` opzionale nel tipo (fake esistenti di `analyze.test.ts`); stub `matchPeople` nel fake e2e fino a T16; conteggi superset di §12 (`selected`, `not_found`, `not_searched`, `apollo_id_taken`, `credits_used`).
- **files edited/created**: `src/jobs/enrich.ts`, `src/server/routes/enrich.ts`, `src/enrich/apollo-match.ts`, `src/jobs/fake-deps.ts` (voce enrich), `src/jobs/types.ts` (commento enrich), `tests/enrich-apollo.test.ts`, `tests/enrich-prospects.test.ts`
- **backlog_item_id**: AL-S6
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#g-email-di-lavoro-via-apollo-arricchimento-con-scelta-del-provider]]
- **relation_mode**: body-links
- **tdd_target**: RED — `GET /api/enrich/preview?prospectIds=…&provider=apollo` esclude chi ha l'email e conta `est_credits` = target; dopo il job `enriched_at` è ancora `null`.
- **review_mode**: cli

### T11: API candidate e collegamenti (referenze, dettaglio azienda)

- **depends_on**: [T5]
- **location**: `src/server/routes/candidates.ts`, `src/db/icps.ts`
- **description**: `GET /api/icps/:id/candidates?status=` (con `score_parts`, `scoring_version`), `PATCH …/:companyId {status}` (idempotente),
  `POST …/bulk` per item (§12), `GET /api/companies/:id/candidate-of`, `GET /api/companies/:id/contacts-at`
  (SPEC F12, da `lastContactsByCompany`); 404 ICP/candidata; `icps.ts#
  setReferenceCompany` chiama `removeCandidate` (SPEC E4); `removeReferenceCompany` non ricrea candidate.
- **validation**: lista per stato con `last_contacts_at`; PATCH `scartata` → `decided_at`; "Riproponi" → `decided_at` aggiornata (SPEC E2); stesso stato →
  200; bulk con un id inesistente → `{updated 2, failed [1]}`; promozione a referenza → candidata sparita;
  `candidate-of` con 2 ICP → 2 righe; `contacts-at` senza fonti → `{last_contacts_at: null}`, con fonte → la data più recente.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. Route candidate (lista per stato con `counts`, `last_run` e `last_contacts_at`; PATCH idempotente che aggiorna sempre `decided_at`; bulk per item), `GET /api/companies/:id/candidate-of`, `GET /api/companies/:id/contacts-at?listId=`; `setReferenceCompany` rimuove la candidatura nella stessa transazione e la PUT della referenza restituisce `candidate_removed` (E4). RED 501 → GREEN (`api-candidates` 8, `api-icps` +2).
  - Scelte: `total` = candidate nello stato ignorando il tetto di 500; `listId` inesistente su `contacts-at` → `null`; elementi con anche `icp_id`/`job_id`.
- **files edited/created**: `src/server/routes/candidates.ts`, `src/db/icps.ts`, `tests/api-candidates.test.ts`, `tests/api-icps.test.ts`, `tests/app-skeleton.test.ts` (stub rimossi)
- **backlog_item_id**: AL-S4
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#e-candidate-e-triage]]
- **relation_mode**: body-links
- **tdd_target**: RED — `POST /api/icps/:id/candidates/bulk {company_ids:[a,b,999], status:'accettata'}` → `{updated:2, failed:[{company_id:999}]}`.
- **review_mode**: cli

### T12a: Tracer bullet FE — readiness Apollo, card "Aziende simili" e dialog in sola preview

- **depends_on**: [T7a, T7c]
- **location**: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/lib/jobs.ts`, `web/src/routes/settings.tsx`, `web/src/routes/index.tsx`, `web/src/routes/icps.$id.tsx`, `web/src/components/IcpForm.tsx`, `web/src/components/LookalikeCard.tsx`, `web/src/components/LookalikeDialog.tsx`, `web/src/components/EnrichCompaniesDialog.tsx`
- **description**: tipi/client minimi (`readiness.apollo`, `LookalikePreview`, `EnrichCompaniesPreview`,
  `api.lookalike.preview/runs/start`, `api.enrichCompanies.preview/start`, nuovi kind in `JobPreviewParams`,
  `fetchPreview`, `JOB_KIND_LABELS`, chiavi di invalidazione al termine del job); riga readiness in
  Impostazioni e onboarding (FLOW Entry points); estrazione di `IcpForm`/`ChipsInput` (nessun cambio di
  comportamento); `LookalikeCard` (stato referenze + "Arricchisci referenze", riga blocker anticipata, ultima
  ricerca, "Ricerche precedenti" con la distribuzione fascia × stato e "senza località" di `runs[].stats`
  (FLOW A.1, SPEC D14) e "Riusa questi filtri"); `EnrichCompaniesDialog` (FLOW A.1b);
  `LookalikeDialog` (FLOW A.2 completo: referenze, chip con origine, fasce con mappatura, località, pagine,
  riga "continua dalla pagina N / Ricomincia", riga crediti sempre visibile, costo, warning/blocker; spunta
  pipeline **presente ma disabilitata** con hint "in arrivo"); riga card "Delta: non trovata il <data>".
  Avvio collegato (202 → banner;
  l'handler stub fallisce con `NotImplemented`: accettato in questo task).
- **validation**: agent-browser contro `npm run e2e:server` (chiave finta da T1; nessun job fake ancora:
  seme via API — ICP dell'esempio SPEC, 2 aziende create con `linkedin_url` + `website` sulla route
  attuale, T4b non è una dipendenza — come referenze): `/settings` riga Apollo verde e,
  con `E2E_NO_APOLLO=1`, rossa; card "2 referenze con sito (0 arricchite, 2 da arricchire)"; dialog
  arricchimento "Crediti stimati: 2 = 2 referenze"; dialog ricerca con filtri **solo dall'ICP** (warning
  "non arricchite"), "1 = 1 pagina", "stima non disponibile"; con `E2E_NO_APOLLO=1` blocker e "Avvia"
  disabilitato in entrambi; `tsc` verde. Lo stato "arricchita" si verifica in T13 con i job fake di T16.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done (browser). Readiness Apollo in Impostazioni (card "Configurazione") e home; `IcpForm`/`ChipsInput` estratti senza cambi; `LookalikeCard` (referenze, riga blocker anticipata, ultima ricerca + conteggi, "Ricerche precedenti" con distribuzione fascia × stato e "senza località", "Riusa questi filtri", riga "non trovata il <data>"), `EnrichCompaniesDialog` (A.1b) e `LookalikeDialog` (A.2 + S-7: pagina 25 · 50 · 100, riga crediti "fino a 26", ripartenza/Ricomincia, blocker `role="alert"`, pipeline disabilitata "in arrivo"). Verificato con agent-browser contro il server fake con e senza `E2E_NO_APOLLO` (21 screenshot in scratchpad `t12a/`); build + typecheck web verdi; processi fermati.
  - Deviazioni: "Costo stimato" resta quello di `JobPreviewDialog` (il suggerimento su `APOLLO_CREDIT_USD` sta nel riepilogo); la nota fasce non riporta il numero di dipendenti (non esposto dalla preview); conteggi candidate non ancora cliccabili (T13). Follow-up: `max_pages` nella preview, `CandidatesResponse.items` tipizzati (T12), primo focus del dialog sul chip.
- **files edited/created**: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/lib/jobs.ts`, `web/src/routes/settings.tsx`, `web/src/routes/index.tsx`, `web/src/routes/icps.$id.tsx`, `web/src/components/{IcpForm,ChipsInput,LookalikeCard,LookalikeDialog,EnrichCompaniesDialog}.tsx`
- **backlog_item_id**: AL-S3
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/FLOW#a-trova-aziende-simili-con-preview-crediti-visibili-filtri-derivati-modificabili]]
- **relation_mode**: body-links
- **tdd_target**: comportamento osservabile: dalla pagina ICP si vedono crediti, costo e blocker di entrambe le preview prima di qualunque job.
- **review_mode**: browser

### T7b: Job `lookalike_companies` (handler reale)

- **depends_on**: [T7a, T2, T3]
- **location**: `src/jobs/lookalike-companies.ts`
- **description**: `Deps {searchOrganizations(filters, page) → {items, declared, pagination}}`; `realDeps()`
  via `createApolloClient` + `requests.ts` (lo stub di T5 include già `searchPeople` per T9). Handler:
  verifica config in cima; legge `JOB_ID` dall'env come `fake-deps.ts#currentJobId` (null nei test in
  process) per `icp_company_candidates.job_id`; per pagina da `startPage`, fermandosi quando una pagina
  dichiara meno di 100 aziende (`last_page_declared` nei counts: D6 "ricerca esaurita"):
  search → `mapOrganizations` (dichiarate vs riconosciute: 0 riconosciute con dichiarate > 0 → warning
  "Apollo ha risposto ma nessuna azienda è stata riconosciuta", nessuna candidata) → escludi
  `knownCompanyIdsForIcp` (`known`: comunque `upsertCompany` per acquisire chiavi/dati Apollo, B7, senza
  `upsertCandidate`) → referenze ritrovate con l'altra chiave → `upsertCompany` (`references_completed`,
  `merged`, non candidate) → altre → `upsertCompany` (Regole di unione; `key_conflicts` e `no_keys` saltate e contate) +
  `scoreCandidate` + `upsertCandidate` con `parts` e `SCORING_VERSION` (`new_candidates`, `without_linkedin`,
  `without_location` = candidate nuove con `parts.location === null`); **ogni pagina in una transazione**; errore dopo ≥ 1 pagina → `succeeded` con `warnings` e `last_page`; prima → throw; 403 →
  `config:`; warning > 50 % senza LinkedIn; `summary` FLOW A.3 (successo / zero neutro / parziale);
  `result.counts` §12.
- **validation**: fixture: pagina di 5 di cui 1 referenza (URL) e 1 già azienda solo-LinkedIn con stesso
  dominio, 1 senza URL, 1 senza città né regione → `read 5, new_candidates 3, references_completed 1, merged 1,
  without_linkedin 1, without_location 1, pages_read 1, credits_used 1` e `score_parts` salvate; referenza di **un altro** ICP → candidata normale; secondo run stessi
  filtri → `startPage 2` e nessun duplicato; rate limit alla pagina 2 di 3 → `succeeded`, warning, `last_page
  1`; 403 alla pagina 1 → `failed` `config:`; 5 dichiarate 0 riconosciute → warning e 0 candidate.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. `runLookalike(params, deps)` + handler: per pagina transazione aziende (`upsertCompany` solo chiavi/nome/sito, mai `apollo_org_id`; `no_keys`, `key_conflicts` con warning, `merged`, `references_completed`, `known`) → `enrichCompanies` sulle nuove (S-7) → transazione candidate con punteggio dai dati Apollo salvati; stop su pagina non piena; errore prima della prima pagina salvata → job fallito attribuito, dopo → parziale con warning ("continuo dalla pagina N"); `candidateCompanyIds` e `partial` esportati per T9. RED `NotImplementedError` → GREEN 16/16; vitest 490/490.
  - Scelte: un 429 al minuto o un 401/403 durante l'arricchimento ferma la ricerca dopo la pagina (parziale); pagina dichiarata ma 0 riconosciute = credito contato, pagina non letta. Limite noto → tech debt: le candidate salvate senza dati Apollo (arricchimento fermato) non vengono mai ripunteggiate.
- **files edited/created**: `src/jobs/lookalike-companies.ts`, `tests/lookalike-companies.test.ts`
- **backlog_item_id**: AL-S3
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#d-trova-aziende-simili-preview--job]]
- **relation_mode**: body-links
- **tdd_target**: RED — `lookalikeCompanies(params, fakeDeps)` crea 3 candidate `proposta` con `score`/`reasons` e ritorna `counts.new_candidates === 3` e `counts.last_page === 1`.
- **review_mode**: cli

### T9: Pipeline opt-in `autoContacts`

- **depends_on**: [T7b, T8]
- **location**: `src/jobs/lookalike-companies.ts`, `src/server/routes/lookalike.ts`
- **description**: `params.autoContacts {listId, roles, seniorities, locations, perCompany}` validato;
  preview: blocker H4 (lista attiva) e `counts.requests` sommate; handler: dopo la ricerca chiama
  `runApolloPeople` sugli id delle candidate **create da questo job** (restano `proposta`);
  `result.counts.contacts_*`; errore nel passo contatti → esito parziale riuscito con il warning
  attribuito (SPEC H3, FLOW error path); `summary` FLOW E.
- **validation**: run con `autoContacts` → candidate `proposta` + membri in lista + `contacts_added`; senza
  lista → blocker e 400; 403 nel passo contatti → `succeeded`, candidate presenti, warning `config:`.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. Pipeline `autoContacts` in `lookalike_companies`: preview con stima ricerca + contatti e scomposizione (`search_est_credits`, `contacts_est_credits`, `contacts_requests`, …; 1 pagina × 25 × 10 = 26 + 250 crediti), warning FLOW E.2, blocker H4 e blocker lista di C; `configBlockers` copre la lista ("Riprova" bloccata su lista archiviata). Handler: dopo `runLookalike`, `runApolloPeople` sulle candidate create da questo job (per `job_id`, punteggio decrescente), che restano `proposta`; conteggi `contacts_*`, riepilogo su due righe (`\n`); errore nel passo contatti → `succeeded` con warning attribuito (H3). Rimosso `pipeline_unavailable`. RED → GREEN; vitest 500/500.
  - Scelte: il passo contatti gira anche dopo una ricerca parziale; "Riprova" di una pipeline il cui passo contatti è fallito non ricerca i contatti (candidate già note): lo dice il warning. Limite: se `runApolloPeople` lancia dopo un match pagato, i crediti di quel match non arrivano nei conteggi (AL-TD-5).
  - 2026-09-17 — Follow-up (AL-TD-5 chiuso): `runApolloPeople` lancia `ApolloPeopleError {counts, detail}`; l'errore del job dichiara "N crediti usati" e la pipeline riporta i conteggi parziali in `contacts_*` e nel warning. Costante unica `APOLLO_KEY_BLOCKER` in `src/config.ts` (vecchi nomi alias per `tests/jobs.test.ts`). RED 2 → GREEN; vitest 502/502.
- **files edited/created**: `src/jobs/lookalike-companies.ts`, `src/server/routes/lookalike.ts`, `tests/lookalike-companies.test.ts`, `tests/lookalike-preview.test.ts`
- **backlog_item_id**: AL-S7
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#h-opzione-pipeline-aziende--contatti-in-un-click]]
- **relation_mode**: body-links
- **tdd_target**: RED — job con `autoContacts` e deps che falliscono con 403 nel passo persone termina `succeeded` con 3 candidate e un warning che inizia per `config:`.
- **review_mode**: cli

### T16: Deps fake e fixture e2e per i job Apollo, README e2e

- **depends_on**: [T9, T7c, T8, T10]
- **location**: `src/jobs/fake-deps.ts`, `tests/fixtures/e2e/`, `tests/e2e/README.md`, `scripts/e2e-server.ts`
- **description**: `fakeDeps` per `enrich_companies`, `lookalike_companies`, `apollo_people` e `matchPeople`
  dell'`enrich`; fixture `apollo-organizations.json`, `apollo-search.json` (2 pagine), `apollo-people.json`,
  `apollo-match.json`; scenari `__fixture`: `EMPTY`, `FAIL`, `FAIL_ONCE`, `PARTIAL` (rate limit alla pagina/
  azienda/lotto 2), `NOSCOPE` (403 `config:`), `UNRECOGNIZED` (dichiarate > 0, riconosciute 0); parole
  chiave nei dati (dominio `nolinkedin.example`, persona `senza-url`, persona `id-preso`); seed: ICP con 3 referenze (2 con dominio, 1 arricchita), 1 lista, 1 azienda solo-dominio. README e2e:
  trigger + mappa FLOW A–F → come ottenerlo.
- **validation**: `tests/e2e-deps.test.ts` per ogni scenario via handler reale; `E2E_NO_APOLLO=1 npm run
  e2e:server` → blocker chiave nelle 4 preview.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. Deps fake Apollo che passano dal client reale (`createApolloClient` + builder) con un `fetch` finto sulle fixture `tests/fixtures/e2e/apollo-*.json` (58 aziende paginate per `perPage`, arricchimenti, persone, match; tutto inventato, domini `.example`) → errori con le classi e i testi di produzione. Scenari con parole `apollo-empty | -fail | -fail-once | -partial | -hourly | -noscope | -badkey | -unrecognized` in nome ICP/lista, chip, sito/nome azienda o nome prospect (`__fixture` solo nei test: le route Apollo sono strict). Seed Apollo: ICP 2 "HR tech Milano" (Acme arricchita, Beta da arricchire, Delta solo LinkedIn), lista 2 con prospect senza email e uno con id Apollo preso, azienda 5 solo dominio `nolinkedin.example`, ICP 3 con lista 3 (conflitto chiavi, non trovata). README e2e con mappa FLOW A–F + Error paths. RED `seed.apollo` undefined → GREEN (`e2e-deps` 32; vitest 516/516); smoke su :4381 (ricerca riuscita 21 candidate, `apollo-noscope` e `apollo-fail-once` + Riprova) con processi fermati.
  - Scelte: ritardo finto una volta per operazione per job; Acme arricchita nel seed anche con `E2E_NO_APOLLO=1`; scenario in più `apollo-badkey` (401).
- **files edited/created**: `src/jobs/fake-deps.ts`, `tests/fixtures/e2e/apollo-{search,organizations,people,match}.json`, `tests/e2e-deps.test.ts`, `tests/e2e/README.md`, `scripts/e2e-server.ts` (riga di log)
- **backlog_item_id**: AL-S8
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#constraints]]
- **relation_mode**: body-links
- **tdd_target**: RED — con `E2E_FAKE_JOBS=1` e `__fixture:'PARTIAL'` il job lookalike termina `succeeded` con warning "Limite Apollo raggiunto" e `last_page 1`.
- **review_mode**: cli

### T6: "Riprova" ripassa dai blocker di configurazione (globale, chiude TD-25)

- **depends_on**: [T7a, T7c, T8, T10, T11, T4b]
- **location**: `src/server/jobs.ts`, `src/server/routes/jobs.ts`, `src/jobs/{sync-interactions,source-company,analyze}.ts`, `src/server/routes/{sync,companies,analyze}.ts`, `src/jobs/handlers.ts`
- **description**: i kind esistenti esportano `configBlockers(params)` (logica spostata dalle route, che
  la chiamano; testi invariati; `source_company` include il blocker "senza pagina LinkedIn" di T4b);
  `CONFIG_BLOCKERS` in `handlers.ts` completo per i 7 kind (i nuovi già esportano la funzione da W2);
  `retryJob` → `JobBlockedError` → 400 `{code:'blocked', blockers}`; riga di stato TD-25 nel tech-debt.
- **validation**: per ciascun kind: job `failed` + blocker → retry 400 `blocked` con lo stesso testo della
  preview; blocker rimosso → 202; test esistenti verdi.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done. `configBlockers(params)` esportati da `sync-interactions` (profilo, token Apify), `source-company` (azienda sparita, `NO_LINKEDIN_BLOCKER`, token, lista sparita/archiviata) e `analyze` (`ANTHROPIC_BLOCKER`, lista/ICP spariti o archiviati, token Apify se servono arricchimenti) e usati dalle route (testi invariati); `CONFIG_BLOCKERS` completo per i 7 kind; `retryJob` → `JobBlockedError` → 400 `{error:'Riprova bloccata: …', code:'blocked', blockers}` senza nuova riga; `isAlive` da `util/process`. RED 202 → 400; `jobs` 18/18, test delle route 124/124.
  - TD-25 segnato **parzialmente** chiuso (resta: "Riprova" senza preview/costo; analisi di lista che ripianifica). Non coperti: `enrich` con lista cancellata e `enrich_companies`/`lookalike_companies` con ICP cancellato falliscono subito con `config:` invece di essere bloccati.
- **files edited/created**: `src/server/jobs.ts`, `src/server/routes/jobs.ts`, `src/jobs/handlers.ts`, `src/jobs/{sync-interactions,source-company,analyze}.ts`, `src/server/routes/{sync,companies,analyze}.ts`, `tests/jobs.test.ts`, `brain/tech-debt/prospect-crm/crm-foundation.md` (TD-25)
- **backlog_item_id**: AL-S8
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#i-coerenza-con-il-dominio]]
- **relation_mode**: body-links
- **tdd_target**: RED — job `enrich` `failed` con `listId` archiviata → `POST /api/jobs/:id/retry` 400 `code:'blocked'` senza nuovo job.
- **review_mode**: cli

### T12: Fondazione frontend completa (tipi, client, hook job, invalidazioni)

- **depends_on**: [T12a, T9, T10, T11, T16, T6]
- **location**: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/lib/jobs.ts`
- **description**: completa i tipi §12 (`Candidate`, `CandidateStatus`, `ContactsPreview`, `EnrichProvider`,
  `SOURCE_KINDS + 'apollo_people'` con etichetta "Apollo", `Company.domain/apollo_*`, `candidate_of`);
  `api.candidates.*`, `api.contacts.*`, `api.companies.merge/candidateOf/enrichApollo`, `api.enrich.*` con
  `provider`; `queryKeys.candidates(icpId, status)`, `lookalikeRuns(icpId)`; invalidazione di candidate,
  ICP, liste e prospect al termine dei job Apollo; `jobOutcomeLink` e `isZeroOutcome` (switch esaustivo) per i 3 kind; etichetta
  "Arricchimento (Apollo)" per `enrich` con `params.provider==='apollo'` (P-16); `describeJobError`
  riconosce `config:` con "master key" (banner rosso persistente con rimedio).
- **validation**: build + typecheck verdi; agent-browser: al termine di un job lookalike (e2e) la sezione
  Candidate si aggiorna senza reload.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done (mixed). Tipi completi di §12-bis (candidate, contatti, pipeline, provider enrich, aziende con URL nullabile/dominio/unione/409 `company_exists`, conteggi dei job), `api.candidates/contacts/companies.*` (unione, candidate-of, contacts-at, enrichApollo) e query della pipeline; chiavi `candidatesOfIcp/companyCandidateOf/companyContactsAt/companyMergePreview`; `jobKindLabel` ("Arricchimento (Apollo)"), `jobOutcomeLinks` (pipeline → "Apri lista" + "Vedi candidate"), `isZeroOutcome` esaustivo, `describeJobError/describeJobWarning` con rimedio, `invalidateAfterJob`/`invalidateCandidateQueries`; JobBanner con riepilogo su più righe, più link, warning `config:` persistenti e "Riprova" bloccata con i blocker inline. Build + typecheck verdi; 12 screenshot `t12/` contro il server fake (ricerca dalla UI con aggiornamento della card senza reload, pipeline e contatti `apollo-noscope`, enrich Apollo); processi fermati.
  - Fix solo di compilazione fuori scope (companies.index/$id, SourceCompanyDialog, icps.$id, ProspectTable, prospects.$id; icona provvisoria `apollo_people`). Note per T14: le righe delle tabelle prospect non hanno `apollo_matched_at` (serve una modifica server).
- **files edited/created**: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/lib/jobs.ts`, `web/src/components/JobBanner.tsx` + fix di compilazione in `web/src/routes/{companies.index,companies.$id,icps.$id,prospects.$id}.tsx`, `web/src/components/{SourceCompanyDialog,ProspectTable}.tsx`
- **backlog_item_id**: AL-S1
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#a-configurazione-e-readiness]]
- **relation_mode**: body-links
- **tdd_target**: comportamento osservabile: esito di un job Apollo con link "Vedi candidate" e aggiornamento automatico della pagina ICP.
- **review_mode**: mixed

### T13: Pagina ICP: candidate + triage, `ContactsDialog`, pipeline attiva

- **depends_on**: [T12]
- **location**: `web/src/routes/icps.$id.tsx`, `web/src/components/CandidatesTable.tsx`, `web/src/components/ContactsDialog.tsx`, `web/src/components/LookalikeDialog.tsx`, `web/src/components/LookalikeCard.tsx`
- **description**: `CandidatesTable` (FLOW B): filtro stato in URL `?candidates=`, colonne, punteggio in %,
  "perché simile", selezione + bulk Accetta/Scarta/Riproponi con esito per item ("10 riuscite · 2 errori ·
  Riprova le fallite"), toast post-bulk "Trova contatti in queste N", badge "già cercata il <data>", empty
  state per stato, paginazione client a 50 con `cpage` nell'URL (P-17), `validateSearch` con default
  `proposta`, toast "Stato non aggiornato: <errore>" sul cambio singolo fallito, copy "Elimina ICP" estesa
  alle candidate. `ContactsDialog` (FLOW C): `ListPicker`
  (preselezione se unica), ruoli/seniority/località/tetto, preview 0 crediti + richieste + warning/blocker;
  `onStart` → `api.contacts.start`; prop `mode: 'icp' | 'company'`: in `company` (usato da T15, SPEC F12) il
  `ListPicker` mostra **tutte** le liste attive raggruppate per ICP, i default di ruoli/località si
  ricalcolano al cambio lista dall'ICP della lista, e l'ICP della chiamata è quello della lista. `LookalikeDialog`:
  spunta pipeline attiva con i campi contatti e la somma delle richieste. Card: conteggi cliccabili verso la
  sezione; chip "perché simile" con "stessa città di …" / "stessa regione di …" / "sede non disponibile".
- **validation**: agent-browser contro e2e: A→B→C completi (preview, avvio, esito, candidate, accetta in
  bulk, toast, dialog contatti, avvio, esito "aggiunte"), E (pipeline con lista), `EMPTY`, `PARTIAL`,
  `NOSCOPE` (banner rosso con rimedio), bulk con errore per item; tab order, `role="alert"`, e dopo Accetta/Scarta/Riproponi (riga e bulk)
  `document.activeElement !== body` (FLOW Accessibilità); `tsc`.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done (browser). `CandidatesTable` (filtro e pagina nell'URL, colonne con punteggio %, ragioni brevi con testo completo nel tooltip, badge "Senza pagina LinkedIn" e "già cercata il <data>", triage di riga e bulk senza conferme con esito per item e "Riprova le fallite", toast "Trova contatti in queste N", focus mai su `body`, empty state per stato, "Seleziona tutte le N filtrate"), `ContactsDialog` con `mode: 'icp' | 'company'` (in `company` le liste di tutti gli ICP e i default dall'ICP della lista), pipeline attiva in `LookalikeDialog` (crediti "fino a 26 (ricerca) + fino a 250 (persone trovate)", lista creabile inline), conteggi della card cliccabili e "Riprova con altri filtri". 25 screenshot `t13/` (A→B→C, pipeline, `apollo-empty`, `apollo-partial`, `apollo-noscope`, bulk con errore per item, paginazione con 52 candidate); build + typecheck web verdi; processi fermati.
  - Deviazioni: chip "perché simile" abbreviati (testo intero nel tooltip e per screen reader); riga contatti senza "limite del piano ≈ 200/min" (non esposto dalla preview); toast post-bulk persistenti; picker liste proprio in modalità `icp` (`ListPicker` non filtra per ICP).
- **files edited/created**: `web/src/routes/icps.$id.tsx`, `web/src/components/CandidatesTable.tsx`, `web/src/components/ContactsDialog.tsx`, `web/src/components/LookalikeDialog.tsx`, `web/src/components/LookalikeCard.tsx`
- **backlog_item_id**: AL-S4
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/FLOW#b-triage-delle-candidate-per-riga-e-in-bulk-reversibile-senza-conferme]]
- **relation_mode**: body-links
- **tdd_target**: comportamento osservabile: dalla card, con e2e, si arriva a 4 prospect in lista con fonte "Apollo · <azienda>" senza toccare stati.
- **review_mode**: browser

### T14: `EnrichDialog` con provider, etichette e icone fonte `apollo_people`

- **depends_on**: [T12]
- **location**: `web/src/components/BulkBar.tsx`, `web/src/routes/prospects.$id.tsx`, `web/src/components/ProspectTable.tsx`, `web/src/routes/inbox.tsx`, `web/src/routes/lists.$id.tsx`
- **description**: radio Provider (FLOW D.1) nei due `EnrichDialog` con testi di costo relativo, conteggi
  Apollo, spunta "Riprova anche quelli senza risultato" sul tentativo Apollo, blocker "Nessun profilo da
  cercare con queste opzioni"; esito e timeline (FLOW D.3; badge "arricchito" invariato). Icona/etichetta
  `apollo_people` in `ProspectTable`, dettaglio prospect, `INBOX_SOURCES`, contatore fonti in Lista.
- **validation**: agent-browser: Lista → selezione → Arricchisci… → Apollo → preview con crediti → avvio →
  esito; `PARTIAL` → "I 6 restanti restano da cercare"; prospect Apollo mostra la fonte; Inbox filtra per
  "Apollo"; `tsc`.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done (browser). Radio Provider nei tre `EnrichDialog` (bulk, azione sulla lista, singolo) con testi D.1/D.2, crediti sempre visibili, "Riprova anche quelli senza risultato" sul tentativo Apollo (azzerata al cambio provider), blocker "Nessun profilo da cercare"; "email non disponibile" in tabella (tooltip data + provider) e nel dettaglio da `apollo_matched_at` aggiunto alle righe (server + test `api-prospects`); fonte Apollo con icona propria, `aria-label` e tooltip in tabella, "Fonti" del dettaglio e filtri Inbox/Lista. 14 screenshot `t14/` contro il server fake (esito email, rilancio bloccato, `apollo-partial`, timeline, fonti); gate verdi (vitest 517/517); processi fermati.
  - Deviazioni: prezzo Apify a persona ricavato da una preview in più; dettaglio di un prospect già arricchito senza email preseleziona Apollo; nessun contatore fonti in Lista (non esisteva), solo il filtro.
- **files edited/created**: `web/src/components/BulkBar.tsx`, `web/src/routes/prospects.$id.tsx`, `web/src/components/ProspectTable.tsx`, `web/src/routes/inbox.tsx`, `web/src/routes/lists.$id.tsx`, `web/src/api/types.ts` (`ProspectRow.apollo_matched_at`), `src/db/prospects.ts` (`apollo_matched_at` nelle righe), `tests/api-prospects.test.ts`
- **backlog_item_id**: AL-S6
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/FLOW#d-email-di-lavoro-via-apollo-dallarricchimento-provider-a-scelta-costo-relativo-visibile]]
- **relation_mode**: body-links
- **tdd_target**: comportamento osservabile: con provider Apollo la preview esclude chi ha già l'email e dopo il job il badge "arricchito" è invariato.
- **review_mode**: browser

### T15: Pagine Aziende: dominio, "Senza pagina LinkedIn", 409 + "Unisci in", candidata per ICP, "Arricchisci con Apollo"

- **depends_on**: [T12, T4b, T13]
- **location**: `web/src/routes/companies.index.tsx`, `web/src/routes/companies.$id.tsx`, `web/src/components/SourceCompanyDialog.tsx`
- **description**: FLOW F: campo unico "URL LinkedIn o sito web" in creazione (toast solo-dominio; 409
  inline con link "già usato da <altra>"); colonna Dominio + badge testo; ricerca per dominio; dettaglio:
  campi URL LinkedIn e Sito web con "Dominio: …", errore "Serve almeno l'URL LinkedIn o il sito web", 409 con
  azione "Unisci in <azienda>" → dialog di conferma che elenca cosa si perde (chiave scartata, note, righe
  assorbite: da `GET /api/companies/:id/merge/preview?into=`) → `api.companies.merge` → redirect + toast
  "Aziende unite"; card "Candidata
  per ICP" con stato/punteggio/azioni; toast sulla promozione a referenza ("uscita dalle candidate di
  <ICP>"); azione "Arricchisci con Apollo" (1 credito) con `EnrichCompaniesDialog`; riga blocker accanto a
  "Estrai persone"; azione **"Trova contatti"** (SPEC F12, FLOW C.1): `ContactsDialog` in `mode: 'company'`
  con `companyIds=[id]`, disabilitata senza dominio con motivo "Serve il sito web", accanto "contatti cercati
  il <data>" da `GET /api/companies/:id/contacts-at`; `companyLabel`/`shortCompanyUrl` tollerano `linkedin_url` null.
- **validation**: agent-browser: crea `acme.it` → badge; dettaglio → URL già usato → 409 → "Unisci in" →
  redirect; "Arricchisci con Apollo" → preview 1 credito; "Estrai persone" su solo-dominio → blocker, dopo
  l'URL → preview senza blocker; "Trova contatti" su `acme.it` → dialog con le liste di due ICP raggruppate,
  cambio lista → ruoli aggiornati → avvio → esito e "contatti cercati il <data>"; azienda senza dominio →
  bottone disabilitato con motivo; `tsc`.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done (browser). Aziende: campo unico "URL LinkedIn o sito web" (409 inline con link, toast per le aziende solo-dominio), colonna Dominio + badge "Senza pagina LinkedIn", ricerca per dominio; dettaglio con chiavi editabili ("Dominio: …", "Serve almeno l'URL LinkedIn o il sito web"), 409 → "Unisci in <azienda>" con conferma da `merge/preview` → redirect + toast "Aziende unite in '<nome>'", card "Candidata per ICP" con triage e focus conservato, toast "uscita dalle candidate di <ICP>", azioni "Estrai persone" (riga blocker), "Arricchisci con Apollo" (`EnrichCompaniesDialog` in modalità azienda, blocker "Già arricchita il <data>") e "Trova contatti" (`ContactsDialog` `mode:'company'`, liste di due ICP con default aggiornati, disabilitata senza dominio, "contatti cercati il <data>"). 28 screenshot `t15/`; build + typecheck verdi; processi fermati.
  - Deviazioni: testo del 409 in creazione "Azienda già presente con lo stesso dominio / URL LinkedIn: apri <nome>"; dialog di unione a elenchi ("Cosa si perde" / "Cosa assorbe"); anteprima del dominio che rispecchia `normalizeDomain`; P-18 invariata (AL-TD-3). Lacune server minori: l'API non distingue "non trovata" da "chiavi in conflitto"; preview singola a 0 crediti con `est_cost_usd: 0`.
- **files edited/created**: `web/src/routes/companies.index.tsx`, `web/src/routes/companies.$id.tsx`, `web/src/components/SourceCompanyDialog.tsx`, `web/src/components/EnrichCompaniesDialog.tsx` (modalità azienda)
- **backlog_item_id**: AL-S2
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/FLOW#f-azienda-solo-dominio--url-linkedin-a-mano--sourcing-apify-sbloccato]]
- **relation_mode**: body-links
- **tdd_target**: comportamento osservabile: un'azienda creata da dominio mostra "Senza pagina LinkedIn" e il sourcing è bloccato finché non si inserisce l'URL.
- **review_mode**: browser

### T17: README, AGENTS, IMPLEMENTATION-NOTES

- **depends_on**: [T13, T14, T15]
- **location**: `README.md`, `AGENTS.md`, `CLAUDE.md`, `brain/specs/prospect-crm/apollo-lookalike/IMPLEMENTATION-NOTES.md`
- **description**: README: sezione "Apollo" (piano, master key o permesso, crediti per operazione, backoff
  429 e ritentativi, rate limit, variabili, verifica preliminare `npm run apollo:smoke` con costo ≈ 3
  crediti), "Aziende" (doppia chiave, migrazione con backup `.bak-`, unione), "Arricchimento" (due
  provider; Apollo non rende "arricchito"; analisi possono diventare `stale`), tabella costi; AGENTS.md:
  identità azienda (`upsertCompany`/`mergeCompanies`), i 3 kind, `CONFIG_BLOCKERS`, retry con blocker;
  `CLAUDE.md` se non è symlink; IMPLEMENTATION-NOTES con frontmatter, deviazioni e sorprese per task.
- **validation**: `grep` delle 5 variabili `APOLLO_*` in README e `.env.example`; link del README aperti;
  typecheck invariato.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done (docs). README: sezioni nuove "Aziende" (doppia chiave, regole dominio, 409 + "Unisci in", unioni nei job, migrazione con backup `.bak-`), "Arricchimento" (Apify vs Apollo, Apollo non rende "arricchito", analisi `stale`) e "Apollo" (piano/permesso, tabella crediti con S-6/S-7, rate limit reali e comportamento del client, `apollo:smoke` ≈ 4 crediti); percorso Apollo nel Flusso consigliato, 5 variabili `APOLLO_*`, e2e `E2E_NO_APOLLO`/`apollo-…`. AGENTS: identità aziende, richieste/client/mapper Apollo, `configBlockers` + `CONFIG_BLOCKERS` per i nuovi kind, `migrateSchema`. Verificati grep variabili, link, typecheck. IMPLEMENTATION-NOTES aggiornate dall'orchestratore durante il run.
  - Da ricontrollare dopo T15: copy delle pagine Aziende citato nel README; il form referenze della pagina ICP accetta ancora solo l'URL LinkedIn (SPEC B13).
- **files edited/created**: `README.md`, `AGENTS.md` (`CLAUDE.md` symlink), `brain/specs/prospect-crm/apollo-lookalike/IMPLEMENTATION-NOTES.md` (orchestratore)
- **backlog_item_id**: AL-S1
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/SPEC#a-configurazione-e-readiness]]
- **relation_mode**: body-links
- **tdd_target**: nessuno (documentazione); validazione = checklist del task.
- **review_mode**: cli

### T18: Smoke end-to-end (agent-browser) sui percorsi A–F e sugli error path

- **depends_on**: [T17]
- **location**: `tests/e2e/smoke-apollo.md`
- **description**: contro `npm run e2e:server` + Vite: A (arricchisci referenze → ricerca) → B → C → D
  (email), E (pipeline, incluso 403 nel passo contatti), F (azienda solo-dominio → URL → sourcing; "Trova
  contatti" dal dettaglio azienda, SPEC F12); "Ricerche precedenti" con distribuzione (SPEC D14); tutte le
  righe della tabella Error paths del FLOW; edge case (referenza tra i risultati, unione, rilancio con
  "continua dalla pagina 2", candidata promossa, eliminazione ICP, retry bloccato). Screenshot nello
  scratchpad; esito in `tests/e2e/smoke-apollo.md`; drift durevole in
  `brain/tech-debt/prospect-crm/apollo-lookalike.md` (creato: annota almeno P-15 e P-18). Poi `implement-spec` esegue
  l'`ux-advisor` (UX-REVIEW.md).
- **validation**: `smoke-apollo.md` con esito per riga (OK / attrito / bug) e nessun bug BLOCKER aperto; 4
  gate verdi; server e Vite fermati per PID.
- **status**: Complete
- **log**:
  - 2026-09-17 — Done (browser). Smoke A–F + 28 Error paths + 15 Edge cases in `tests/e2e/smoke-apollo.md`: tracer OK da DB e2e vuoto (4 preview; crediti dichiarati fino a 58, usati 37; prospect in lista con fonte "Apollo · Gamma Welfare Srl" ed email di lavoro dal match; email Apollo senza cambiare il badge "arricchito"), 89 OK · 4 attriti · 4 bug MINOR, nessun BLOCKER/MAJOR; nuovi AL-TD-6…11 nel tech debt; 84 screenshot `t18/`; server, Vite e sessione agent-browser fermati per PID. Non eseguiti: `ux-advisor` e audit dei criteri (esclusi dall'utente per questa sessione).
- **files edited/created**: `tests/e2e/smoke-apollo.md`, `brain/tech-debt/prospect-crm/apollo-lookalike.md` (AL-TD-6…11)
- **backlog_item_id**: AL-S8
- **backlog_item_url**: [[specs/prospect-crm/apollo-lookalike/FLOW#error-paths]]
- **relation_mode**: body-links
- **tdd_target**: comportamento osservabile end-to-end: a DB e2e vuoto si arriva a un prospect in lista con fonte "Apollo · <azienda>" ed email di lavoro passando da 4 preview.
- **review_mode**: browser

## 15. Gate di validazione per ondata

| Ondata | Gate |
|---|---|
| W0 | 4 gate verdi sulla base; commit + branch; smoke eseguito (o rinviato con nota in §7) |
| W1 | `typecheck` + `vitest` verdi; migrazione testata su DB vecchio con backup; app monta le 4 route stub; contratto params/result nei commenti di `types.ts` |
| W2a/b | preview di ricerca e arricchimento visibili nel browser (T12a) prima del handler reale della ricerca (T7b) |
| W2c/d | `vitest` verde; `E2E_FAKE_JOBS=1` copre i 3 job + enrich Apollo; `CONFIG_BLOCKERS` per 7 kind; `git diff --stat` per task rispetta la mappa §8 |
| W3 | build + typecheck web verdi; agent-browser per T13/T14/T15 con screenshot |
| W4 | README/AGENTS aggiornati; smoke T18 senza BLOCKER; IMPLEMENTATION-NOTES; poi `ux-advisor` (UX-REVIEW) e, in **nuova sessione**, `adversarial-review` |

## 16. Questioni aperte (non bloccanti)

| # | Questione | Default del piano |
|---|---|---|
| 1 | Se T0 rivela che `bulk_enrich` non è disponibile sul piano | `requests.ts` espone anche `organizations/enrich` singolo; T7c usa il singolo |
| 2 | Se T0 mostra che `mixed_people/api_search` limita `per_page` sotto `perCompany` | clamp di `perCompany` al massimo reale, documentato |
| 3 | ~~Collisioni di dominio: riga UI "dominio già usato da <altra>"~~ | Deviazione dichiarata P-18: solo log + 409; T18 la annota nel tech-debt |
| 4 | ~~Pesi del punteggio e top-10 (SPEC OQ-4)~~ | Chiusa 2026-09-17 (U-4): costanti in `similarity.ts`; ricerche analizzabili via `score_parts`, `scoring_version`, `runs[].stats` |
| 5 | ~~"Trova contatti" dal dettaglio azienda (SPEC OQ-3)~~ | Chiusa 2026-09-17 (U-3): incluso, SPEC F12; `ContactsDialog` `mode: 'company'` (T13) usato da T15 |
| 6 | ~~`merge` da UI: superstite~~ | Risolto in SPEC B5: nell'unione esplicita resta l'azienda indicata; nei job vale la regola delle Regole di unione |
