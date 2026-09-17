---
domain: prospect-crm
type: plan
spec: crm-foundation
links:
  - "[[specs/prospect-crm/crm-foundation/FLOW|FLOW]]"
  - "[[specs/prospect-crm/prospect-crm-specs|prospect-crm-specs]]"
created: 2026-09-16
updated: 2026-09-16
---

# PLAN — Pivot a CRM di prospecting LinkedIn (`crm-foundation`)

**Status:** In progress
**Execution mode (suggerito):** `parallel` a ondate. La wave 1 (purge → schema/scheletro) è sequenziale
e blocca tutto; le wave 2–4 hanno catene server parallele **per-file** (ogni task edita solo i file che
possiede: `app.ts` e il registry dei job handler sono pre-cablati da T3 con stub, nessun co-edit); le
pagine frontend corrono in parallelo dopo la fondazione FE. Ogni task server è un tracer bullet RED→GREEN
vitest; ogni task FE si valida con `tsc --noEmit` + `agent-browser` contro il server fake di T20 (nessun
runner FE: decisione di progetto ereditata).

> **Nessuna `SPEC.md` a monte.** Questo piano nasce da una richiesta di pianificazione esplicita (pivot
> completo del progetto). Le sezioni 1–3 e il ledger fanno da problem statement; il contratto di flusso
> (happy/error/edge, testi UI) è in [[specs/prospect-crm/crm-foundation/FLOW|FLOW.md]]; le *story*
> CRM-S0…S8 in §12 sono il backlog product-facing a cui i task puntano (`relation_mode: body-links`,
> nessun tracker esterno, coerente con i piani precedenti del repo). Se in futuro si vuole formalizzare la
> spec, `create-spec` può derivarla da §1–§3 + §12 + FLOW senza cambiare i task.

---

## 1. Situazione iniziale

Il repo `sevedemo-tools` è oggi il **Lead Engine** di SeVedemo: pipeline giornaliera che estrae ~200
candidati LinkedIn via Apify, li arricchisce, li classifica con Claude in due bucket (freelance/azienda),
ne seleziona 20+20, genera bozze email con Sonnet ed esporta CSV. Web UI locale (Hono `:8787` + React 19,
TanStack Router/Query, Tailwind 4, shadcn) con Dashboard/Selezioni/Contatti/Run/Report. Baseline
verificata: `npm run typecheck` verde, 25 file vitest / 131 test verdi. Brain con dominio `lead-engine`
(7 spec implementate, 10 flow, 11 concept, ADR 0001, contract).

Verificato in discovery (riferimenti al codice **attuale**, che il piano in parte elimina):

- **Estrazione da post** — `src/strategies/post-extract.ts`: mapper puri `extractPost` (id attività da
  `urn.activity_urn`/`full_urn`, url, persone/aziende taggate) e `mapComments` (autore → `linkedin_url`
  normalizzato, headline, `sourcePostUrl`). Orchestrazione iniettabile in
  `src/strategies/influencer-post-respondents.ts` (`collectRespondents(limit, deps)`: post → commenti,
  errori per-post isolati). Fixture reali in `tests/fixtures/apimaestro-*.json`.
- **Actor Apify** — `src/apify/actors.ts` (unico punto di adattamento input): `profilePostsApimaestro`
  (`{username, total_posts}`), `postComments` (`{postIds, limit, sortOrder}`), `profileDetail`
  (`{username, includeEmail:true}`, single-profile). `src/apify/client.ts → runActor()` bloccante.
- **Enrichment profilo** — `src/enrich/profile-detail.ts`: `mapProfileDetailItem` (output annidato
  `basic_info.*`, email con fallback regex su about, `raw.experience/education/certifications`),
  `enrichProfileDetails(urls)` a concorrenza 3, chiave = URL di input. ⚠️ Importa `type Enrichment` da
  `src/db/contacts.ts` (file che si cancella): il tipo va spostato dentro `profile-detail.ts` in T2.
- **Utilità** — `src/util/fields.ts`: `field()` multi-chiave tollerante, `normalizeLinkedinUrl()`
  (chiave identità, case dello slug preservato), `hasEmail()`, `truncate()`. ⚠️ `toCsv` sta in
  `src/export/csv.ts:36` (cartella da cancellare), **non** in `src/util/csv.ts` (che contiene solo
  `parseCsv`/`truthy` legacy per l'import outcome): T2 sposta `toCsv` in `util/csv.ts`.
- **Job asincroni** — `src/server/jobs.ts`: `createJobController(kvKey)` con stato in `kv`, processo
  figlio `tsx` via `spawn`, wrapper che scrive l'esito terminale, guard pid-morto → `failed`, un solo job
  alla volta. ⚠️ Importa `../pipeline/enrich-selection.js` e `db/kv`: si **cancella** in T2 e rinasce in
  T6 sul nuovo modello (`jobs` table), riusando il pattern.
- **Server** — `src/server/app.ts` importa `db/contacts`, `db/erase`, `db/runs`, `strategies/registry`,
  `export/csv`, `server/queries`: T2 lo riduce a scheletro health-only (altrimenti il typecheck di W1 non
  può passare).
- **DB** — `src/db/index.ts`: SQLite `better-sqlite3`, WAL, `busy_timeout`, schema inline + `migrate()`
  con `ensureColumn`. Tabelle `contacts/runs/daily_selection/kv/outcomes` (tutte da sostituire);
  `src/db/kv.ts` diventa orfano → si cancella.
- **Test harness** — `tests/setup.ts` isola `DB_PATH` e maschera `ANTHROPIC_API_KEY`; i test importano i
  moduli DB con `await import()` dinamico; pattern `createApp().request()` su Hono.
  `tests/extraction-mapping.test.ts` importa anche `strategies/people-search.js` (da cancellare): resta
  solo il blocco su `normalizeLinkedinUrl`.
- **Frontend** — `web/`: shadcn init già fatto (`components.json`, alias `@/`, `cn()`, CSS vars in
  `styles.css`), primitivi `button/input/select/checkbox/dialog/badge`, `FilterBar`/`FilterChips`
  state-source-agnostic, `ui.tsx` legacy (`PageHeader`, `Card`, `Badge`, `Loading`, `ErrorBox`,
  `EmptyState`, toast, **e uno `StatusBadge` legacy a r.176 da rimuovere**). `api/client.ts` con
  `ApiError` (status preservato) e `qs()`. `web/src/routeTree.gen.ts` è **tracciato in git** ed è
  generato dal plugin TanStack: dopo la cancellazione delle route va rigenerato (`vite build`) prima di
  `tsc`.
- **Claude** — `@anthropic-ai/sdk` installato **0.65.0**: non ha `output_config` né `messages.parse`.
  Versione corrente su npm **0.126.0** (structured outputs GA). `src/score/claude.ts` usa `tool_choice`
  forzato con Haiku 4.5: pattern non riusabile (vedi D12).

## 2. Problema

Il progetto cambia scopo: da generatore giornaliero di cold-email per SeVedemo a **CRM personale di
prospecting** per un unico utente (Omar). Quasi tutto il codice esistente (bucket, scoring, selezione,
bozze, evaluation, strategie people-search/cookie, geo-gate, UI relativa) codifica il vecchio scopo e va
eliminato. Vanno tenute solo le due capacità tecniche ancora utili — estrazione dai post ed enrichment del
profilo — e ricostruito attorno a loro un modello ICP → liste → prospect → contatto.

L'utente deve poter:

1. definire **di cosa si occupa la sua azienda** e uno o più **ICP** (profilo cliente ideale), con
   **aziende di riferimento** (trattative avanzate/chiuse bene) che ne alimentano la definizione;
2. **collegare il proprio profilo LinkedIn** (URL pubblico, nessun login) e generare prospect da chi
   **reagisce e commenta** i suoi post;
3. inserire **URL di aziende** ed estrarne le **persone** che matchano i ruoli dell'ICP (il lookalike via
   Apollo o simili è futuro: solo il seam va predisposto);
4. organizzare i prospect in **liste per ICP** e gestire il **contatto** (stati, touchpoint multipli,
   messaggi manuali) di ogni persona;
5. chiedere all'**AI** — e solo per questo — un riassunto del profilo, gli **angoli di apertura**
   (da bio ed esperienze) e un fit leggero rispetto all'ICP;
6. **esportare** una lista verso gli email tool (CSV).

## 3. Forma della soluzione

Riscrittura del dominio applicativo mantenendo stack, harness di test, adapter Apify e i due moduli
tecnici da conservare. Tre strati:

- **Kernel dati nuovo** (`data/crm.db`, 13 tabelle in §6): `settings`, `icps`, `companies`,
  `icp_reference_companies`, `lists`, `prospects`, `list_members`, `sources` (provenienza multipla),
  `posts`, `activities` (timeline unica), `analyses`, `jobs`, `exports`. Identità del prospect =
  `linkedin_url` normalizzato (invariante ereditato).
- **Acquisizione** in due fonti, entrambe job asincroni con **preview uniforme** prima dell'avvio:
  **Sync interazioni** (i miei post → reazioni + commenti → prospect in **Inbox** con `sources`) e
  **Sourcing da azienda** (URL company → dipendenti filtrati per ruoli ICP → membri della lista scelta).
  Più enrichment on-demand (single/bulk) e **analisi AI** on-demand (single sincrona / bulk job) con
  structured outputs.
- **Web UI** ricostruita: Onboarding · Inbox · Liste (per ICP) · Lista · Prospect · ICP · Aziende ·
  Impostazioni (profilo, azienda, post + sync, ultimi job). Export CSV per lista con filtri o selezione,
  con log di attività.

Provider seam predisposti ma non implementati: `CompanyLookalikeProvider` (Apollo), `OutreachProvider`
(Brevo): solo documentati nel contract del dominio, nessun file vuoto. Nessuno scheduling: l'utente
lancia i job dalla UI.

## 4. Decision ledger (risolto nel grill)

| # | Decisione | Esito | Rationale |
|---|-----------|-------|-----------|
| D1 | Perimetro di eliminazione | **Tutti gli 8 blocchi**: bucket/scoring/rubric, selezione 20+20 + `daily_selection` + pipeline daily, bozze Sonnet, evaluation/`outcomes`, strategie people-search/cookie + company-expansion + seeds query/job-urls + registry, geo-gate Italia, enrichment batch `dev_fusion`, pagine UI e CLI vecchie | Greenfield attorno a post-extract + enrichment apimaestro. La geografia diventa attributo dell'ICP. |
| D2 | Ruolo delle aziende | Due ruoli: **aziende di riferimento** dell'ICP (trattative avanzate/vinte) e base per **liste lookalike** | Richiesta esplicita dell'utente; il lookalike è "più avanti". |
| D3 | Taglio v1 aziende | **Entità Azienda + riferimenti ICP + sourcing persone da azienda** (actor `harvestapi/linkedin-company-employees`). Lookalike Apollo **solo seam** | Fattibile subito con Apify e adapter esistente; Apollo richiede credenziali e ricerca a parte. |
| D4 | Prospect ↔ liste | **Prospect unico** per `linkedin_url`, **many-to-many** con le liste, **status sul prospect** | Niente stati duplicati; "già contattato" vale ovunque compaia. |
| D5 | Contatti multipli | **Timeline di touchpoint** per prospect (data, canale, direzione, lista, testo, esito) | Condizione posta dall'utente per accettare D4. |
| D6 | Stati | `nuovo → qualificato → da_contattare → contattato → risposto → in_conversazione → chiuso_vinto \| chiuso_perso \| scartato`, **cambio manuale**, ogni cambio logga un'attività | Struttura dell'outreach; nessun automatismo. |
| D7 | Canale email | **Export CSV per lista** con filtri; l'export logga un touchpoint `export`. Invio integrato dietro seam `OutreachProvider`, dopo | Chiude il loop subito, zero credenziali. |
| D8 | Analisi AI | **On-demand** (bottone sul prospect + bulk sulla lista). Output: riassunto, 3 angoli motivati, **fit ICP leggero** (alto/medio/basso + frase). Assegnazione e stato restano manuali | Controllo costi; triage veloce dei commentatori. |
| D9 | Brain `lead-engine` | **Eliminare** `domains/`, `specs/`, `tech-debt/` di lead-engine; aggiornare `index.md`/`log.md`; creare dominio `prospect-crm` | Documentazione di un sistema che non esiste più inganna gli agenti. |
| D10 | Database | **Schema nuovo su `data/crm.db`**, vuoto; `sevedemo.db` resta su disco, non importato | I dati legacy erano raccolti per un altro ICP e un altro modello. |
| D11 | Profilo LinkedIn "collegato" | = **URL pubblico** salvato in `settings`, letto con actor **no-cookie** | Nessun login/cookie: niente rischio ban, coerente con l'invariante ereditato. |
| D12 | Modello dell'analisi | **`claude-opus-5`** di default (env `ANALYSIS_MODEL`), **structured outputs** (`output_config.format` + zod), niente `tool_choice` forzato. **Richiede il bump di `@anthropic-ai/sdk` a ≥ 0.126** (T3) con fallback "prompt JSON-only + zod" se il modello configurato non supporta il formato | Volume basso e on-demand: qualità degli angoli > costo; il tool-use forzato è rimosso sui modelli Fable e fragile in prospettiva. |

### Decisioni prese in pianificazione (non chieste: derivate dal ledger e dal FLOW, contestabili)

| # | Decisione | Esito | Rationale |
|---|-----------|-------|-----------|
| P1 | Dove atterrano i prospect da **Sync interazioni** | In **Inbox** (prospect senza membership), con le `sources` visibili; l'utente li assegna a una lista o li marca `scartato` (anche in bulk); "Mostra scartati" + "Ripristina" come rete di sicurezza | D8: l'assegnazione alla lista è manuale. Chi reagisce ai post non è per forza dell'ICP. |
| P2 | Dove atterrano i prospect da **Sourcing azienda** | **Direttamente nella lista scelta** al lancio del job (stato `nuovo`) | L'utente ha già scelto ICP/azienda: il triage è implicito nel filtro ruoli. |
| P3 | Timeline | **Una sola tabella `activities`** (kind: `status_change`, `touchpoint`, `note`, `export`, `analysis`, `enrichment`) | Una query per la timeline; il touchpoint è un'attività con canale/direzione/testo. |
| P4 | Provenienza | Tabella **`sources`** many-per-prospect con **unicità** su `(prospect_id, kind, post_id)` e `(prospect_id, kind, company_id)`; `post_reaction`/`post_comment`/`company_employees`/`manual`, `reaction_type`, testo del commento | La stessa persona può reagire a 3 post: è un segnale per gli angoli AI; il re-sync non deve duplicare. |
| P5 | Analisi senza enrichment | L'analisi **richiede** il prospect arricchito. Bulk: il job arricchisce prima i mancanti (preview con "N da arricchire + M da analizzare"). Singola: `enrichFirst` **inline lato server** nella stessa richiesta sincrona (non un job: non collide con "un solo job alla volta") | Senza about/esperienze l'analisi è vuota; la UI rende il costo esplicito. |
| P6 | Regola di ri-sync dei post | Un post con `last_synced_at` non nullo si **ri-scarica solo** con `force` **oppure** se `last_synced_at` è più vecchio di `SYNC_COOLDOWN_DAYS` (default 7) **e** il post è entro `POST_RECENCY_DAYS` (default 90). Post oltre i 90 gg: mai, salvo `force`. Se `reactions_count > 0` e reazioni lette = 0 → `last_synced_at` **non** si aggiorna e il result porta un `warning` | Non pagare due volte lo stesso post (invariante anti-spesa) ma raccogliere le nuove interazioni sui post recenti. |
| P7 | Job | Tabella **`jobs`** (kind, params, state, pid, result, error); **un solo job alla volta**; stesso pattern spawn + wrapper; **preview uniforme** `{counts, est_cost_usd: number\|null, warnings[], blockers[]}` per ogni kind; `blockers` non vuoti = il job non parte; **retry** con gli stessi `params` | Quattro kind di job rendono le chiavi kv insostenibili; il momento di ansia è il clic "Avvia". |
| P8 | Cambio stato da touchpoint | Il form touchpoint ha un campo opzionale "nuovo stato" (default: nessun cambio) | Comodità senza automatismo (D6). |
| P9 | Bulk su selezione | Tutti i bulk (stato, aggiungi/rimuovi lista, enrich, analyze, export) accettano `prospectIds[]`; "seleziona tutti i filtrati" via endpoint `/ids` (cap 500) | L'Inbox con 100+ righe è inutilizzabile senza bulk oltre la pagina (FLOW). |
| P10 | Sourcing Full/Full+email | Se l'item ha about/esperienze, il sourcing marca il prospect **arricchito** (`enriched_at`) | Non ripagare profile-detail per dati già comprati. |

## 5. Assunzioni e vincoli

- **Single-user, locale, niente auth**; SQLite unica fonte di verità; gli export sono viste.
- **Identità = `linkedin_url` normalizzato** (`normalizeLinkedinUrl`), `UNIQUE` su `prospects` e
  `companies` (URL company normalizzato allo stesso modo: `https://www.linkedin.com/company/<slug>`).
  *(Steering 2026-09-16)* Per i prospect **seconda chiave `member_urn`** (id membro `ACoAA…`, unico se
  presente): la stessa persona arriva come slug (commenti) o come id membro (reazioni). `linkedin_url` passa
  allo slug appena è noto (slug in minuscolo, id membro case-sensitive); quando una fonte rivela che due
  prospect sono la stessa persona si **uniscono** (`src/db/identity.ts`). Il sync aggancia reazione solo-id e
  commento solo-slug con stesso nome **e** headline (`upsertProspect(…, {linkByName: true})`).
- **Adattamento provider in un solo punto**: gli input degli actor si toccano solo in
  `src/apify/actors.ts`; la lettura output è tollerante (`field()`).
- **Best-effort con isolamento per item**: un post/azienda/profilo che fallisce non ferma il job;
  fail-fast solo su configurazione (token, URL profilo mancante) — e la configurazione mancante è un
  `blocker` in preview, quindi il job non parte affatto.
- **No cookie**: nessun uso di `LINKEDIN_LI_AT` (variabile rimossa).
- **Test**: server = vitest (`tests/*.test.ts`, `npm test`), FE = `tsc --noEmit` + `agent-browser`.
  I job nei test usano `command` override o `deps` fake (mai actor reali); gli actor si testano sui
  **mapper puri** con fixture JSON; Claude si testa con un `client` iniettato.
- **Costi indicativi** (per `est_cost_usd` e cap di default): reazioni $5/1000 (apimaestro), commenti
  come oggi, dipendenti $4/1000 (Short) – $8 (Full) – $12 (Full+email) (harvestapi), profile-detail
  = costante `PRICE_PROFILE_DETAIL_USD` da valorizzare (finché è `null` la preview dice "stima non
  disponibile"); analisi Opus 5 ≈ 3k input + 0,7k output ≈ **$0,03 per prospect**.
- **GDPR/ToS**: i prospect EU sono dati personali; `sources` conserva la provenienza; l'outreach deve
  prevedere opt-out. Non è consulenza legale.
- **Fuori scope (predisposti, non costruiti)**: lookalike Apollo, invio email integrato (Brevo),
  scheduling, multi-utente, import del DB legacy, progresso parziale dei job ("12/22").

## 6. Modello dati (schema `data/crm.db`, 13 tabelle)

```
settings            key TEXT PK, value TEXT               -- own_profile_url, company_name, company_description, company_offering
icps                id, name, description, target_roles JSON, target_industries JSON, target_locations JSON,
                    company_size TEXT, pains TEXT, notes TEXT, created_at, updated_at
companies           id, linkedin_url UNIQUE, name, website, industry, size, location, notes, created_at, updated_at
icp_reference_companies  icp_id FK, company_id FK, outcome ('vinta'|'in_trattativa'|'persa'|'riferimento'), notes,
                    PK(icp_id, company_id)
lists               id, icp_id FK, name, description, created_at, archived_at NULL   -- archiviata = nascosta + job disabilitati
prospects           id, linkedin_url UNIQUE, member_urn UNIQUE NULL (steering), full_name, headline, about, location, email, phone,
                    company_id FK NULL, company_name, title, raw_json, enriched_at NULL, enrichment_attempted_at NULL,
                    status TEXT NOT NULL DEFAULT 'nuovo' CHECK(status IN (9 stati)), status_changed_at,
                    created_at, updated_at
list_members        list_id FK, prospect_id FK, added_at, PK(list_id, prospect_id)
sources             id, prospect_id FK, kind ('post_reaction'|'post_comment'|'company_employees'|'manual'),
                    post_id FK NULL, company_id FK NULL, reaction_type NULL, comment_text NULL, raw_json, captured_at
                    UNIQUE(prospect_id, kind, post_id) WHERE post_id IS NOT NULL
                    UNIQUE(prospect_id, kind, company_id) WHERE company_id IS NOT NULL
                    UNIQUE(prospect_id, kind) WHERE post_id IS NULL AND company_id IS NULL   -- 'manual'
posts               id, post_url UNIQUE, activity_id, text_excerpt, posted_at, reactions_count, comments_count, last_synced_at NULL
activities          id, prospect_id FK, list_id FK NULL, kind ('status_change'|'touchpoint'|'note'|'export'|'analysis'|'enrichment'),
                    channel NULL ('email'|'linkedin_dm'|'linkedin_comment'|'call'|'other'), direction NULL ('outbound'|'inbound'),
                    from_status NULL, to_status NULL, body TEXT NULL, meta JSON NULL, occurred_at, created_at
analyses            id, prospect_id FK, icp_id FK, model, summary, angles JSON [{title, rationale}], fit ('alto'|'medio'|'basso'),
                    fit_reason, input_hash, created_at        -- ultima per (prospect, icp) = corrente; stale se input_hash ≠ attuale
jobs                id, kind ('sync_interactions'|'source_company'|'enrich'|'analyze'), params JSON, state ('running'|'succeeded'|'failed'),
                    pid, started_at, finished_at, result JSON, error, created_at
exports             id, list_id FK, filters JSON, prospect_ids JSON NULL, count, created_at       -- il CSV si scarica per id
```

Indici: `prospects(member_urn) WHERE NOT NULL` (unico), `prospects(full_name)`, `prospects(status)`, `prospects(company_id)`, `list_members(prospect_id)`, `sources(prospect_id)`,
`activities(prospect_id, occurred_at)`, `analyses(prospect_id, icp_id, created_at)`, `jobs(state)`.
Derivati (mai colonne): "Inbox" = prospect senza `list_members` e `status <> 'scartato'`; "arricchito" =
`enriched_at IS NOT NULL`; "analizzato per l'ICP X" = esiste `analyses` con quell'`icp_id`; `stale` =
`analyses.input_hash ≠ hash(input corrente)`.

## 7. Ricerca esterna usata

- **`apimaestro/linkedin-post-reactions`** (no-cookie, $5/1000): input `{post_urls: string[],
  page_number?: 1, limit?: 1-100 (default 50), reaction_type?: ALL|LIKE|PRAISE|EMPATHY|APPRECIATION|INTEREST}`;
  output per reazione `{reaction_type, reactor: {name, headline, profile_url, urn, profile_pictures}, _metadata:
  {post_url, page_number}}`; pagine da 100. **`post_urls` è un array**: una run per pagina su *tutti* i post
  da sincronizzare (non una run per post), iterando `page_number` finché un post torna < 100 item.
  Fonti: <https://apify.com/apimaestro/linkedin-post-reactions>,
  <https://apify.com/apimaestro/linkedin-post-reactions/input-schema>.
- **`harvestapi/linkedin-company-employees`** (no-cookie): input = lista di **URL company** (o nomi),
  filtri per job title/location/keyword/seniority, `maxItems` (0 = tutti, cap 2.500), `profileScraperMode`
  Short ($4/1000: nome, headline, url, location, posizione corrente) | Full ($8/1000: + esperienze,
  formazione, skill) | Full+email ($12/1000). ⚠️ I **nomi esatti dei campi input** vanno confermati sulla
  pagina input-schema prima di T7 (la pagina descrive i campi ma il fetch non ha restituito le chiavi
  letterali). Fonti: <https://apify.com/harvestapi/linkedin-company-employees>,
  <https://apify.com/harvestapi/linkedin-company-employees/input-schema>.
- **Claude API (skill `claude-api`, 2026-09)**: modello di default `claude-opus-5`; thinking adattivo di
  default; structured outputs via `output_config: {format: {type:'json_schema', schema}}`; `tool_choice`
  forzato è rimosso su Fable 5.1 e sconsigliato; `max_tokens` non striminzito (qui 4000 basta);
  gestire `stop_reason === 'refusal'` (con `stop_details`) e `'max_tokens'`; SDK TypeScript ≥ 0.126
  necessario (0.65 installato non ha `output_config`).
- Actor già in uso e validati con smoke reale nel repo: `apimaestro/linkedin-profile-posts`,
  `apimaestro/linkedin-post-comments-replies-engagements-scraper-no-cookies`,
  `apimaestro/linkedin-profile-detail`.

## 8. Grafo delle dipendenze e ondate

```
W1  T1 brain-reset                     T2 purge-legacy ──► T3 schema + config + SDK bump + scheletro (routes stub, handlers stub)
W2  T3 ─► T4 settings/ICP/aziende API   T3 ─► T5 liste/prospect/attività API   T3 ─► T6 jobs generico + preview type
    T2 ─► T7 adapter actor + mapper puri
W3  T5+T6+T7 ─► T8 sync-interazioni     T4+T5+T6+T7 ─► T9 sourcing-azienda     T5+T6 ─► T10 enrichment
    T4+T5+T6+T10 ─► T11 analisi AI
W4  T5+T11 ─► T12 export CSV            T4+T5+T6 ─► T13 fondazione FE (client, nav, onboarding, JobBanner+retry, JobPreviewDialog, SyncDialog, ListPicker)
    T6+T8+T9+T10+T11 ─► T20 server fake e2e (fixture-backed deps, client Claude fake)
W5  T13+T4+T8+T20 ─► T14 FE Impostazioni/ICP/Sync      T13+T5+T10+T11+T12+T20 ─► T15 FE Inbox/Liste/Lista
    T13+T5+T10+T11+T20 ─► T16 FE Prospect
W6  T13+T4+T9+T20+T15 ─► T19 FE Aziende + Sourcing
W7  T14+T15+T16+T19 ─► T17 README/AGENTS/.env/scripts      T14+T15+T16+T19+T20 ─► T18 smoke end-to-end (happy + unhappy)
```

Ondate parallele: **W1** T1 ∥ (T2 → T3) · **W2** T4 ∥ T5 ∥ T6 ∥ T7 · **W3** T8 ∥ T9 ∥ T10 → T11 ·
**W4** T12 ∥ T13 ∥ T20 · **W5** T14 ∥ T15 ∥ T16 · **W6** T19 · **W7** T17 ∥ T18.

**Regola anti co-edit (vincolante):** T3 crea **tutti** i file di routing e il registry dei job come stub
(`src/server/routes/{settings,icps,companies,lists,prospects,jobs,sync,enrich,analyze,exports}.ts` che
esportano un `Hono` vuoto; `src/jobs/handlers.ts` con mappa `kind → handler` pre-cablata a stub che
lanciano `NotImplemented`), e `app.ts` monta tutti i router una volta per tutte. Da W2 in avanti **nessun
task edita `app.ts`, `handlers.ts` o un file di route/handler che non possiede**: T4 → `routes/settings|
icps|companies.ts`; T5 → `routes/lists|prospects.ts`; T6 → `routes/jobs.ts`, `server/jobs.ts`,
`server/job-entry.ts`; T8 → `routes/sync.ts` + `jobs/sync-interactions.ts`; T9 → `routes/companies.ts`
**solo** dopo T4 (dipendenza dichiarata) + `jobs/source-company.ts`; T10 → `routes/enrich.ts` +
`jobs/enrich.ts`; T11 → `routes/analyze.ts` + `jobs/analyze.ts`; T12 → `routes/exports.ts`. Ogni handler
si registra sostituendo lo stub **nel proprio file** (`handlers.ts` importa da `jobs/<kind>.ts`, che T3 crea
come stub e il task proprietario riempie). Unico file condiviso tra task FE paralleli: `web/src/routeTree.gen.ts`,
**generato** e non tracciato da T2 in avanti — alla merge si rigenera con `build`, mai si risolve a mano.

## 9. Ordine consigliato dall'UX (ux-advisor) — recepito nei task

Vedi [[specs/prospect-crm/crm-foundation/FLOW|FLOW.md]] per percorsi felici/errore/edge e testi UI.
Vincoli di sequenza recepiti:

1. **Fondazione FE "grassa" (T13)**: `JobPreviewDialog` (preview uniforme, blockers, stima), `ListPicker`
   con "Crea nuova lista" inline e `JobBanner` con percorso `failed` + **Riprova** nascono in T13, perché
   servono a T14, T15, T16 e T19: il momento di massima ansia (clic "Avvia" su un job pagato) va risolto
   una volta sola, prima.
2. **Ordine FE**: T13 → T14 (Impostazioni + ICP + Sync: primo job pagato, primo esito onesto) → T15
   (triage bulk dell'Inbox appena riempita) → T16 (dettaglio: "Arricchisci e analizza" e refusal prima
   del polish della timeline) → T19 (Aziende + Sourcing: richiede liste esistenti) → T18.
3. **Preview con blocchi**: nessun job parte e fallisce per configurazione; i `blockers` (token mancanti,
   profilo mancante, job in corso, lista archiviata, ICP senza ruoli per il sourcing) si vedono prima.
4. **Esito onesto**: `result.summary` distingue 0 risultati (neutro) da warning (es. post con reazioni
   ma 0 lette) da errore (attribuito: actor / configurazione / processo).
5. **Empty state guidati**: Onboarding a 3 passi; Inbox vuota → "Sincronizza ora" (riusa il dialog di
   T14); Lista vuota → "Aggiungi dall'Inbox" / "Estrai da un'azienda".
6. **Rete di sicurezza**: "Scarta" senza conferma ma con "Mostra scartati" + "Ripristina"; eliminazione
   di touchpoint/note errati.
7. **Smoke (T18) anche sui percorsi non felici**: job `failed` + Riprova, sync a 0, refusal, prospect in
   due liste con stato globale, Inbox con 2 ICP, descrizione azienda vuota.

## 10. Strategia di test

- **Server (vitest)**: ogni task apre con un test RED sull'interfaccia pubblica (endpoint Hono via
  `createApp().request()` o funzione esportata) su DB temporaneo (`tests/setup.ts` invariato nel
  meccanismo, aggiornato nel path). Mapper actor testati con **fixture JSON** in `tests/fixtures/` (le due
  apimaestro esistenti restano; si aggiungono `apimaestro-post-reactions.json` e
  `harvestapi-company-employees.json`). Job testati con `deps` fake (funzioni pure `syncInteractions(deps)`
  ecc.) e, per il controller, con `command: 'node', args: ['-e', …]` come oggi. Claude **mai chiamato**
  nei test: `analyzeProspect` riceve un `client` iniettabile.
- **Frontend**: `npm --prefix web run typecheck` + scenari `agent-browser` contro il **server fake di
  T20** (`E2E_FAKE_JOBS=1`: DB scratch, job con deps fixture-backed, client Claude fake). Nessun jsdom/RTL.
- **Gate di wave**: fine W1 `npm run typecheck && npm test` verdi (suite ridotta ai 4 test superstiti
  adattati + `purge-guard` + `schema`) e `web` typecheck+build verdi; fine W3 idem con i nuovi test; fine
  W5/W6 build FE verde + scenari browser; W7 smoke end-to-end.

## 11. Rischi e mitigazioni

| Rischio | Impatto | Mitigazione |
|---|---|---|
| **Bump SDK Anthropic 0.65 → ≥ 0.126** può rompere tipi/import residui | Typecheck rosso, D12 irrealizzabile | T3 esegue il bump **dopo** il purge (nessun uso dell'SDK sopravvive a T2), verifica con `tsc` che `output_config` e `stop_reason==='refusal'` siano tipizzati; T11 ha fallback "prompt JSON-only + zod" attivabile via `ANALYSIS_STRUCTURED=0`. |
| Schema input `harvestapi/linkedin-company-employees` non confermato (nomi campo) | T9 fallisce con errore di validazione | T7 apre con lettura dell'input-schema reale e riporta i nomi in commento; smoke manuale a `maxItems: 3`; input isolato in `actors.ts`. |
| Reazioni: reactor senza `profile_url` (profili privati/anonimi) | Prospect non identificabili | Mapper scarta item senza URL normalizzabile, conteggiati nel result (`skipped_no_url`). |
| Dedup reazione/commento della stessa persona; re-sync duplica `sources` | Doppioni, conteggi gonfiati, prompt AI rumoroso | `linkedin_url` unico su `prospects` + seconda chiave `member_urn` con unione automatica e aggancio per nome+headline nel sync (steering, `src/db/identity.ts`); **indici unici parziali** su `sources` + `ON CONFLICT DO UPDATE` (P4). |
| Costo reazioni su post virali (1.000+ reazioni) | Spesa inattesa | Cap `REACTIONS_PER_POST` (default 300) + preview con stima da `posts.reactions_count`; al **primo** sync la preview dichiara "stima non disponibile" e offre `postsOnly` (solo elenco post, gratis-quasi) per poi stimare. |
| Run actor per pagina moltiplicate | Latenza/overhead | Reazioni chiamate in **batch** (`post_urls[]` = tutti i post da sincronizzare) per pagina. |
| Structured outputs / modello: refusal, JSON non conforme, `max_tokens` | Analisi mancante | zod parse + retry 1 volta; `refusal`/`max_tokens` → attività `analysis` con `meta.error` leggibile, mai crash del job; timeout esplicito (90 s) sulla chiamata sincrona. |
| Purge incompleto lascia import rotti | Typecheck rosso, confusione | T2 con checklist esplicita (cancellazioni **e** i 3 file da ridurre/spostare); gate `tsc` + `vitest` a fine W1 **dopo T3**, non dopo T2. |
| `jobs` e SQLite: server + figlio scrivono insieme | `SQLITE_BUSY` | `busy_timeout` ereditato; un solo job attivo (guard su `jobs.state='running'` + pid vivo). |
| Analisi singola sincrona lunga (Opus + thinking, 20–60 s) | Timeout HTTP/UX | Timeout 90 s lato server, `aria-busy` lato UI, messaggio "Sto analizzando…"; mai bloccare la pagina. |
| Brain reset perde conoscenza utile (invarianti dedup/anti-spesa) | Regressioni di design | Invarianti ricopiati in §5 e nel contract del nuovo dominio (T1); `docs-maintenance` lo completa dopo. |
| `routeTree.gen.ts` tracciato e stale dopo la cancellazione delle route | `tsc` rosso in W1 | T2 lo **cancella** e lo rigenera con `npm --prefix web run build` prima del typecheck. |
| Actor apimaestro post-reactions cambia schema | Sync torna 0 | Lettura tollerante (`field`), fixture, esito onesto "0 reazioni lette da N post" **con warning** se `reactions_count > 0`. |

## 12. Backlog (story product-facing, `relation_mode: body-links`)

Nessun tracker esterno (coerente con i piani precedenti). Le story vivono qui; `backlog_item_url` punta
all'anchor della story (`#crm-sN`).

#### CRM-S0
**Pivot: rimozione del Lead Engine e reset del brain.** Task: T1, T2, T3, T17.

#### CRM-S1
**Definire la mia azienda e gli ICP, con aziende di riferimento.** Task: T4, T14.

#### CRM-S2
**Collegare il mio profilo LinkedIn e generare prospect da reazioni e commenti ai miei post.** Task: T7, T8, T14, T20, T18.

#### CRM-S3
**Estrarre persone dalle aziende inserite, filtrate per i ruoli dell'ICP.** Task: T7, T9, T19.

#### CRM-S4
**Organizzare i prospect in liste per ICP e triagiare l'Inbox.** Task: T5, T13, T15.

#### CRM-S5
**Gestire il contatto con ogni prospect: stati, touchpoint multipli, messaggi manuali.** Task: T5, T16.

#### CRM-S6
**Farmi analizzare un prospect dall'AI: riassunto, angoli di apertura, fit ICP.** Task: T11, T15, T16.

#### CRM-S7
**Esportare una lista verso il mio email tool.** Task: T12, T15.

#### CRM-S8
**Arricchire on-demand i prospect (about, esperienze, email).** Task: T6, T10, T15, T16.

## 13. Task

Convenzioni: `location` = file principali; `validation` = comportamento pubblico che prova il task;
`tdd_target` = primo test RED. `status` iniziale `Planned`; `log` e `files edited/created` li compila il
worker in esecuzione. Anchor delle story: `brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-sN`.

### T1: Reset del brain — rimuovere `lead-engine`, creare `prospect-crm`

- **depends_on**: []
- **location**: `brain/domains/lead-engine/`, `brain/specs/lead-engine/`, `brain/tech-debt/lead-engine/`, `brain/index.md`, `brain/log.md`, `brain/specs/prospect-crm/prospect-crm-specs.md`, `brain/domains/prospect-crm/{prospect-crm.md,prospect-crm-contract.md}`
- **description**: Elimina le tre cartelle `lead-engine` (D9). Aggiorna la spec map `brain/specs/prospect-crm/prospect-crm-specs.md` (creata in planning) portando `crm-foundation` a "In progress" quando parte l'esecuzione. Crea il domain map `brain/domains/prospect-crm/prospect-crm.md` (stub: "dominio in costruzione, vedi PLAN/FLOW") e il contract `prospect-crm-contract.md` con **Owns / Does Not Own / Invariants** ripresi da §5 (identità `linkedin_url`, adapter unico, best-effort per item, no cookie, SQLite unica verità, status sul prospect + timeline, un solo job alla volta, preview prima di ogni spesa) e la nota sui seam futuri (`CompanyLookalikeProvider`, `OutreachProvider`) come **Does Not Own**. Aggiorna `brain/index.md` (Domains/Specs/Reviews/Tech debt) e appendi a `brain/log.md`. Non toccare `brain/AGENTS.md`/`CLAUDE.md`. Le pagine `flows/`/`concepts/` **non** si scrivono a mano.
- **validation**: `find brain -path '*lead-engine*'` vuoto; ogni `[[…]]` in `brain/index.md` e nelle nuove pagine risolve a un file esistente; il contract ha le tre sezioni.
- **status**: Done
- **log**:
  - 2026-09-16 (W1, worker): eliminati 61 file lead-engine (domains 31, specs 27, tech-debt 3; recuperabili da `a6f203b`). Creati domain map stub e contract prospect-crm (Owns / Does Not Own con seam `CompanyLookalikeProvider`/`OutreachProvider` solo documentati / Invariants §5 + sources idempotenti, anti-doppia-spesa, esito onesto, AI solo analisi, GDPR). `index.md`: sezione dominio e tabella Specs solo prospect-crm; Reviews/Tech debt vuoti con nota. Spec map → In progress. `log.md`: nuova entry in testa.
  - Validazione: script link-check (scratchpad) prima `FAIL (3)`, dopo `PASS` (index 7 link, spec map 9, domain map 11, contract 5, 0 rotti); `find brain -path '*lead-engine*'` vuoto; contract con le 3 sezioni. Verifica ripetuta dall'orchestratore: PASS.
  - Gotcha: le entry storiche di `log.md` hanno wikilink lead-engine ora pendenti (log append-only, lasciati). Riferimenti residui fuori scope: `README.md:16`, `.env.example:42`, `src/config.ts:68` → T2/T3/T17.
- **files edited/created**:
  - deleted: `brain/domains/lead-engine/` (31), `brain/specs/lead-engine/` (27), `brain/tech-debt/lead-engine/` (3)
  - created: `brain/domains/prospect-crm/prospect-crm.md`, `brain/domains/prospect-crm/prospect-crm-contract.md`
  - edited: `brain/index.md`, `brain/log.md`, `brain/specs/prospect-crm/prospect-crm-specs.md`
- **backlog_item_id**: CRM-S0
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s0
- **relation_mode**: body-links
- **tdd_target**: n/a (artefatto documentale) — verifica meccanica: script che estrae i target `[[…]]` da `brain/index.md` e dalle pagine `prospect-crm/*` e controlla l'esistenza del file.
- **review_mode**: cli

### T2: Purge del codice legacy (cancellazioni + 3 riduzioni/spostamenti)

- **depends_on**: []
- **location**: `src/`, `tests/`, `scripts/`, `data/seeds/`, `web/src/`, `package.json`, `.env.example` — con **edit** su `src/server/app.ts`, `src/enrich/profile-detail.ts`, `src/util/csv.ts`, `web/src/routes/__root.tsx`, `web/src/routes/index.tsx`, `web/src/api/{client,types}.ts`, `web/src/components/ui.tsx`, `tests/extraction-mapping.test.ts`
- **description**: **Cancella**: `src/pipeline/`, `src/score/`, `src/email/`, `src/eval/`, `src/export/` (dopo aver spostato `toCsv`), `src/enrich/profile.ts`, `src/strategies/{people-search,freelance-people-search,decisionmaker-people-search,influencer-followers,job-posters-annunci,company-expansion,registry,seeds,influencer-post-respondents}.ts`, `src/db/{contacts,runs,erase,kv}.ts`, `src/server/{queries,jobs,run-daily-job,run-enrichment-job}.ts`, `scripts/seed-demo.ts`, `scripts/ui-smoke-server.ts`, `data/seeds/*.json`, `outcomes.sample.csv`, tutti i `tests/*.test.ts` **tranne** `post-extract`, `profile-detail`, `apimaestro-actors`, `extraction-mapping`. **Riduci/sposta**: (a) `src/server/app.ts` → scheletro con solo `GET /api/health` e `notFound` JSON (niente import verso moduli cancellati); (b) `src/enrich/profile-detail.ts` → definisce e esporta `Enrichment` in loco (rimosso l'import da `db/contacts`); (c) `src/util/csv.ts` → contiene **`toCsv(rows, columns)`** generalizzata (spostata da `src/export/csv.ts`), rimossi `parseCsv/truthy`; (d) `tests/extraction-mapping.test.ts` → tenere solo il blocco su `normalizeLinkedinUrl`; (e) `src/apify/actors.ts` → rimuovi `profileSearch`, `profileScraper`, `peopleSearchCookie`, `jobsSearchCookie` e i builder relativi; `src/strategies/types.ts` → solo `RawCandidate` (senza `Strategy`); `src/config.ts` → togli le chiavi legacy (bucket target, pool, cookie, primary strategy, scoring/email model, geo) lasciando `apifyToken`, `anthropicApiKey`, `paths`, `ROOT` e le funzioni `requireApify()`/`requireAnthropic()` (usate da `src/apify/client.ts`); `src/cli.ts` → solo `db:init`; `package.json` → rimuovi script `pipeline/strategies/seed:demo`. **Web**: cancella `routes/{selections.*,runs,report,contacts.*}.tsx`, `components/AddContactsDialog.tsx`, `lib/pipeline.ts`, **`routeTree.gen.ts`** (rigenerato dal plugin con `npm --prefix web run build`) e aggiungilo a `.gitignore`: è un file generato che ogni task FE in parallelo rigenererebbe in versioni divergenti, quindi non va più tracciato (il gate FE lo rigenera sempre con `build`); `__root.tsx` con nav vuota temporanea, `index.tsx` placeholder; `api/client.ts`/`api/types.ts` ridotti a `ApiError`, `qs`, `request` e tipi vuoti; `ui.tsx` senza `BucketBadge/FitScore/SelectionStateBadge/StatusBadge` legacy. Non toccare `web/src/components/ui/*`, `filters/*`. Aggiungi `tests/purge-guard.test.ts`.
- **validation**: `npx vitest run` verde con i 4 file adattati + `purge-guard`; `npm --prefix web run build && npm --prefix web run typecheck` verdi; `npm run typecheck` **può restare rosso solo per `src/db/index.ts`** (vecchio schema, sostituito da T3) — tutto il resto compila; `git status` mostra cancellazioni e i soli file elencati in `location`.
- **status**: Done
- **log**:
  - 2026-09-16 (W1, worker): cancellati 72 file (src 29, tests 21, scripts 2 + cartella, data/seeds 4 + cartella, outcomes.sample.csv, web/src 9 incluso `routeTree.gen.ts` rimosso dall'indice con `git rm --cached` e aggiunto a `.gitignore`). `data/sevedemo.db*` intatto (D10).
  - Riduzioni: `app.ts` → `createApp()` senza parametri, solo `/api/health` + `notFound` JSON; `util/csv.ts` → `toCsv<T>(rows, columns)` RFC-4180 generica; `profile-detail.ts` esporta `Enrichment` in loco; `config.ts` → `apifyToken`, `anthropicApiKey`, `paths.{db,exports}`, `ROOT`, `requireApify/requireAnthropic` (rimossi anche `paths.seeds` e helper `int/bool/float/list`); `actors.ts` → solo `profilePostsApimaestro`, `postComments`, `profileDetail`; `strategies/types.ts` → solo `RawCandidate`; `cli.ts` → solo `db:init` (import dinamico del DB); `.env.example` → solo `APIFY_TOKEN`, `ANTHROPIC_API_KEY`, commento `DB_PATH`. Web: `client.ts` esporta `ApiError`/`request`/`qs` (esportati per `noUnusedLocals`), `types.ts` = `export {}`, nav vuota, index placeholder, `ui.tsx` senza badge legacy.
  - RED→GREEN: `purge-guard` 9 fail (7 `existsSync` + `toCsv` assente) → 9 pass (+1 test di escaping `toCsv` oltre il target).
  - Validazione: vitest 5 file / 31 test verdi; `npm run typecheck` **verde anche su `src/db/index.ts`** (legge solo `config.paths.db`); web build + typecheck verdi; `git status` limitato a cancellazioni + location + extra autorizzati. Verifica ripetuta dall'orchestratore: tutto verde.
  - Gotcha: il typecheck web fallisce se lanciato prima di un `build` (`main.tsx` importa `routeTree.gen.ts`, ora non tracciato). Testi "Lead Engine" residui in `src/server/index.ts` (log di avvio, T3), `package.json` description (T17), commento in `web/src/components/filters/emailOptions.ts`. `RawCandidate.sourceDetail` contiene ancora `'tagged-person' | 'company-expansion'` (T7).
- **files edited/created**:
  - deleted: `src/pipeline/`, `src/score/`, `src/email/`, `src/eval/`, `src/export/`, `src/enrich/profile.ts`, 9 file in `src/strategies/`, `src/db/{contacts,runs,erase,kv}.ts`, `src/server/{queries,jobs,run-daily-job,run-enrichment-job}.ts`, `scripts/`, `data/seeds/`, `outcomes.sample.csv`, 21 `tests/*.test.ts`, `web/src/routes/{selections.index,selections.$date,runs,report,contacts.index,contacts.$id}.tsx`, `web/src/components/AddContactsDialog.tsx`, `web/src/lib/pipeline.ts`, `web/src/routeTree.gen.ts` (untracked)
  - edited: `src/server/app.ts`, `src/enrich/profile-detail.ts`, `src/util/csv.ts`, `src/apify/actors.ts`, `src/strategies/types.ts`, `src/config.ts`, `src/cli.ts`, `package.json`, `.env.example`, `.gitignore`, `tests/extraction-mapping.test.ts`, `web/src/routes/__root.tsx`, `web/src/routes/index.tsx`, `web/src/api/{client,types}.ts`, `web/src/components/ui.tsx`
  - created: `tests/purge-guard.test.ts`
- **backlog_item_id**: CRM-S0
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s0
- **relation_mode**: body-links
- **tdd_target**: `tests/purge-guard.test.ts` (RED finché i moduli esistono): `fs.existsSync` è `false` per `src/score`, `src/pipeline`, `src/email`, `src/eval`, `src/export`, `src/db/kv.ts`, `src/server/queries.ts`; e `import('../src/util/csv.js')` espone `toCsv` e **non** `parseCsv`.
- **review_mode**: cli

### T3: Schema `crm.db`, config, bump SDK, scheletro server con stub di route e job

- **depends_on**: [T2]
- **location**: `src/db/index.ts`, `src/db/schema.ts`, `src/config.ts`, `src/server/app.ts`, `src/server/index.ts`, `src/server/routes/{settings,icps,companies,lists,prospects,jobs,sync,enrich,analyze,exports}.ts` (stub), `src/jobs/handlers.ts`, `src/jobs/{sync-interactions,source-company,enrich,analyze}.ts` (stub con `Deps` + `realDeps()`), `src/jobs/fake-deps.ts` (stub), `src/jobs/types.ts`, `package.json`, `tests/setup.ts`, `tests/schema.test.ts`, `tests/app-skeleton.test.ts`
- **description**: `schema.ts` con tabelle/indici di §6 (DDL `CREATE TABLE IF NOT EXISTS`, `CHECK` sugli enum, **indici unici parziali** su `sources`), `PRAGMA foreign_keys = ON`. `db/index.ts` apre `config.paths.db` (default `data/crm.db`), WAL + `busy_timeout`, esegue lo schema; mantiene `ensureColumn`/`hasColumn`; `nowIso()`. `config.ts`: `apifyToken`, `anthropicApiKey`, `analysisModel` (`ANALYSIS_MODEL`, default `claude-opus-5`), `analysisStructured` (`ANALYSIS_STRUCTURED`, default true), `postsPerSync` (10), `postRecencyDays` (90), `syncCooldownDays` (`SYNC_COOLDOWN_DAYS`, 7), `reactionsPerPost` (300), `commentsPerPost` (100), `employeesPerCompany` (50), `employeesMode` (`Short`), `enrichConcurrency` (3), `freshnessDays` (`FRESHNESS_DAYS`, 90), `prices` (`PRICE_PROFILE_DETAIL_USD` → `number|null`, costanti reazioni/dipendenti/analisi di §5), `paths.{db,exports}`. **Bump `@anthropic-ai/sdk` a ≥ 0.126** e `zod` alla versione compatibile; `tsc` deve vedere `output_config` in `MessageCreateParams` e `'refusal'` in `StopReason`. `jobs/types.ts`: `JobKind`, `JobPreview = {counts: Record<string,number>, est_cost_usd: number|null, warnings: string[], blockers: string[]}`, `JobResult = {summary: string, counts, warnings?: string[]}`, `JobHandler = (params, deps?) => Promise<JobResult>`. `jobs/handlers.ts`: `HANDLERS: Record<JobKind, JobHandler>` che importa da `jobs/<kind>.ts`. Ogni `jobs/<kind>.ts` stub esporta **tre** cose: `export type Deps = {…}` (vuoto, lo definisce il task proprietario), `export const handler: JobHandler` (lancia `NotImplementedError`) e `export function realDeps(): Deps` (lancia `NotImplementedError`); `jobs/fake-deps.ts` stub esporta `fakeDeps(kind)` (lancia `NotImplementedError`; lo riempie T20). Così T6 può scrivere il dispatcher delle deps senza conoscere le firme, e T8–T11 riempiono handler **e** `realDeps()` nel proprio file. `app.ts`: `createApp(opts)` monta **tutti** i 10 router con `app.route('/api', router)` (stesso prefisso per tutti: ogni router dichiara **path assolute** sotto `/api`, es. `routes/enrich.ts` definisce `/prospects/:id/enrich` e `/lists/:id/enrich`; così nessun task deve toccare un router altrui per una path cross-risorsa) + `/api/health`; `notFound` JSON globale su `/api/*`. `server/index.ts`: `requestTimeout` del server Node a 300 s (analisi sincrona con `enrichFirst`, vedi T11). `tests/setup.ts`: path `crm-test.db`.
- **validation**: `GET /api/health` → `{ok:true, db}`; qualsiasi path `/api/*` non ancora implementata → 404 JSON dal `notFound` globale; `HANDLERS.enrich({}, realDeps())` rigetta con `NotImplementedError`; `sqlite_master` contiene le 13 tabelle; `INSERT prospects status='selected'` → `SQLITE_CONSTRAINT_CHECK`; due `INSERT sources` identici su `(prospect,kind,post)` → il secondo viola l'unico; `npm run typecheck && npm test` verdi (**gate W1**).
- **status**: Done
- **log**:
  - 2026-09-16 (W1, worker): schema 13 tabelle §6 con enum esportati (`PROSPECT_STATUSES`, `REFERENCE_OUTCOMES`, `SOURCE_KINDS`, `ACTIVITY_KINDS`, `CHANNELS`, `DIRECTIONS`, `FIT_LEVELS`) da cui derivano i `CHECK`; JSON con `CHECK json_valid`; timestamp ISO; 3 indici unici parziali su `sources` (`ux_sources_post|company|manual`) + 7 indici §6; CHECK extra: `post_*` richiede `post_id`, `company_employees` richiede `company_id`. ON DELETE: CASCADE prospect→list_members/sources/activities/analyses, icp→icp_reference_companies/analyses, company→icp_reference_companies, list→list_members/exports; RESTRICT `lists.icp_id`, `sources.post_id`, `sources.company_id`; SET NULL `prospects.company_id`, `activities.list_id`.
  - `@anthropic-ai/sdk` 0.65 → **0.126.0**, `zod` 3 → **4.6.5** (`z.toJSONSchema` disponibile per T11). `config` oggetto mutabile con tutte le chiavi del task + `prices.{postsPer1000Usd, reactionsPer1000Usd, commentsPer1000Usd, employeesPer1000Usd{Short,Full,'Full+email'}, profileDetailUsd|null, analysisPerProspectUsd}`; default DB `data/crm.db`.
  - Contratti per i task successivi: `src/server/types.ts` (`AppOptions {jobs?: {command?, args?}}`, `AppEnv`), `createApp(opts)` con middleware `c.set('opts')`, 10 router `xRoutes = new Hono<AppEnv>()` montati su `/api`, `notFound` + `onError` JSON globali; `jobs/types.ts` (`JOB_KINDS`, `JobPreview`, `JobResult`, `JobHandler<P,D>`, `NotImplementedError`); stub `jobs/<kind>.ts` con `Deps`/`handler`/`realDeps()`; `jobs/handlers.ts` con `HANDLERS`, `DepsByKind`, `REAL_DEPS`; `fakeDeps(kind)` stub; `db/index.ts` → `db`, `ensureColumn`, `hasColumn`, `nowIso()`.
  - Extra: `server/index.ts` `requestTimeout` 300 s, testo di avvio CRM, fallback SPA che **salta `/api`** (prima una path API inesistente tornava HTML 200 con `web/dist` presente). `tests/setup.ts`: `crm-test.db`, `ANTHROPIC_API_KEY` e `APIFY_TOKEN` fittizi (dotenv non sovrascrive).
  - RED→GREEN: `schema.test.ts` (vedeva le tabelle legacy) → 10/10; `app-skeleton.test.ts` (modulo `jobs/handlers` assente + typecheck: `output_config` inesistente su SDK 0.65, `toJSONSchema` assente su zod 3) → 7/7.
  - Gate W1 (worker + ripetuto dall'orchestratore): `npm run typecheck` verde; vitest 9 file / 61 test; web build + typecheck verdi.
  - Deviazione: `app-skeleton.test.ts` usa una path mai esistente invece di `/api/lists` per il 404 e le asserzioni `NotImplementedError` sono state un run one-off (T5/T8–T11 le renderebbero false in un file che non possono editare).
  - Gotcha: `pnpm` nel PATH (9.14.2) fallisce con `ERR_PNPM_UNEXPECTED_STORE`; usare `/usr/local/bin/pnpm` 10.33.0. RESTRICT fallisce con `SQLITE_CONSTRAINT_TRIGGER` (T4: contare le liste prima del delete). T20 reset: cancellare prospect prima di post/aziende e liste prima degli ICP. T8: upsert del post prima della source. FLOW E.3 cita `GET /api/lists/:id/analyze/preview`, il PLAN T11 `GET /api/analyze/preview?listId=` → vale il PLAN.
- **files edited/created**:
  - created: `src/db/schema.ts`, `src/server/types.ts`, `src/server/routes/{settings,icps,companies,lists,prospects,jobs,sync,enrich,analyze,exports}.ts`, `src/jobs/{types,handlers,fake-deps,sync-interactions,source-company,enrich,analyze}.ts`, `tests/schema.test.ts`, `tests/app-skeleton.test.ts`
  - edited: `src/db/index.ts`, `src/config.ts`, `src/server/app.ts`, `src/server/index.ts`, `tests/setup.ts`, `package.json`, `pnpm-lock.yaml`, `.env.example`
- **backlog_item_id**: CRM-S0
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s0
- **relation_mode**: body-links
- **tdd_target**: `tests/schema.test.ts`: dopo `await import('../src/db/index.js')`, l'elenco tabelle è esattamente le 13 di §6 e `INSERT INTO prospects(...) VALUES(...,'selected')` lancia `SQLITE_CONSTRAINT_CHECK`; `tests/app-skeleton.test.ts`: `GET /api/health` 200 e `GET /api/lists` 404 JSON (`notFound` globale).
- **review_mode**: cli

### T4: API Impostazioni, ICP, Aziende e aziende di riferimento

- **depends_on**: [T3]
- **location**: `src/db/settings.ts`, `src/db/icps.ts`, `src/db/companies.ts`, `src/server/routes/settings.ts`, `src/server/routes/icps.ts`, `src/server/routes/companies.ts`, `tests/api-settings.test.ts`, `tests/api-icps.test.ts`, `tests/api-companies.test.ts`
- **description**: Repo + endpoint (zod `.strict()` sui body): `GET/PUT /api/settings` (`own_profile_url` normalizzato con `normalizeLinkedinUrl`, rifiuta URL non-LinkedIn 400; `company_name`, `company_description`, `company_offering`; il GET include `readiness: {apify: boolean, anthropic: boolean, profile: boolean, company: boolean}` per onboarding e blockers). `GET/POST/PATCH/DELETE /api/icps` (delete 409 se ha liste). `GET/POST/PATCH /api/companies` (URL normalizzato + `UNIQUE` → 409 con `existing_id`), `GET /api/companies/:id` (con `reference_of[]` e conteggio prospect). `PUT/DELETE /api/icps/:id/reference-companies/:companyId` con `outcome`/`notes`; `GET /api/icps/:id` include `reference_companies[]` e `lists[]`. Espone `getIcpContext(icpId)` (ICP + azienda utente + riferimenti) per T11 e `getReadiness()` per le preview.
- **validation**: round-trip PUT→GET settings con `readiness.profile===true`; POST ICP → GET lista; PUT riferimento `outcome:'vinta'` → nel GET dell'ICP; URL company duplicato → 409 con `existing_id`.
- **status**: Done
- **log**:
  - 2026-09-16 (W2, worker): repo `db/settings.ts` (`SETTING_KEYS`, `getSettings`, `updateSettings(patch)`, `getReadiness`), `db/icps.ts` (`listIcps`, `getIcp`, `getIcpDetail`, `createIcp`, `updateIcp`, `countIcpLists`, `deleteIcp`, `listReferenceCompanies`, `getReferenceCompany`, `setReferenceCompany(icpId, cid, {outcome?, notes?})`, `removeReferenceCompany`, `getIcpContext(icpId) → {icp, company:{name, description, offering}, referenceCompanies} | null`), `db/companies.ts` (`getCompany`, `findCompanyByUrl(rawUrl)`, `listCompanies({q?})`, `getCompanyDetail`, `createCompany`, `updateCompany`). `util/fields.ts` additivo: `normalizeProfileUrl`, `normalizeCompanyUrl` (slug company lowercase), `cleanText`, `cleanList`.
  - Payload: `GET|PUT /api/settings` → `{own_profile_url, company_name, company_description, company_offering, readiness}`; PUT **parziale** (chiavi omesse invariate, `''`/`null` azzera); `readiness = {apify, anthropic, profile, company, icp, prospects}` (`company` = descrizione non vuota; `icp`/`prospects` aggiunti per l'onboarding). Profilo non `/in/<slug>` → 400 `code:'invalid_profile_url'`. `Icp = {id, name, description, target_roles[], target_industries[], target_locations[], company_size, pains, notes, created_at, updated_at}`; `GET /api/icps` → `{items: Icp & {lists_count, reference_companies_count}}`; `GET|POST|PATCH /api/icps/:id` → `Icp & {reference_companies: {icp_id, company_id, outcome, notes, company: Company}[], lists: {id, name, archived_at}[]}`; `DELETE` → 409 `code:'icp_has_lists'` + `lists_count` (anche liste archiviate). `PUT|DELETE /api/icps/:id/reference-companies/:companyId` (upsert, default `outcome:'riferimento'`). `Company = {id, linkedin_url, name, website, industry, size, location, notes, created_at, updated_at}`; `GET /api/companies?q=` → `{items: Company & {reference_of: {icp_id, icp_name, outcome, notes}[], prospects_count}}`; `GET|POST|PATCH /api/companies/:id` stessa forma; duplicato → 409 `code:'duplicate'` + `existing_id`; URL invalido → 400 `code:'invalid_company_url'`.
  - RED→GREEN: `api-icps` (404 → 201/200/409, `getIcpContext is not a function` → pass), `api-settings` (endpoint inesistente → pass), `api-companies` (404 → 201). 14/14 verdi sui 3 file; typecheck pulito all'ultimo giro (errori transitori solo nei test in corso di T5/T6).
  - Gotcha: con `lists.icp_id` RESTRICT e nessun delete delle liste, un ICP con liste (anche archiviate) non è mai cancellabile: il copy FLOW "archiviale prima" non vale (T14 non deve suggerirlo). `from-url` di T9: `findCompanyByUrl(url) ?? createCompany(...)` poi `setReferenceCompany`. `normalizeLinkedinUrl` accetta host che finiscono per `linkedin.com` (es. `evillinkedin.com`): debolezza preesistente, lasciata.
- **files edited/created**:
  - created: `src/db/settings.ts`, `src/db/icps.ts`, `src/db/companies.ts`, `tests/api-settings.test.ts`, `tests/api-icps.test.ts`, `tests/api-companies.test.ts`
  - edited: `src/server/routes/{settings,icps,companies}.ts`, `src/util/fields.ts` (solo aggiunte)
- **backlog_item_id**: CRM-S1
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s1
- **relation_mode**: body-links
- **tdd_target**: `tests/api-icps.test.ts`: `POST /api/icps {name:'CTO startup', target_roles:['CTO','Head of Engineering']}` → 201; `PUT /api/icps/:id/reference-companies/:cid {outcome:'vinta'}` → `GET /api/icps/:id` ha `reference_companies[0].outcome === 'vinta'`.
- **review_mode**: cli

### T5: API Liste, Prospect, membership, stati, attività

- **depends_on**: [T3]
- **location**: `src/db/lists.ts`, `src/db/prospects.ts`, `src/db/activities.ts`, `src/domain/status.ts`, `src/server/routes/lists.ts`, `src/server/routes/prospects.ts`, `tests/api-lists.test.ts`, `tests/api-prospects.test.ts`, `tests/status-model.test.ts`
- **description**: `domain/status.ts`: enum dei 9 stati + label italiane + `isTerminal()`; cambio libero e manuale via `changeStatus(prospectId, to, {note, listId})` che scrive `activities.kind='status_change'` e aggiorna `status_changed_at`. `prospects.ts`: `upsertProspect(...)` idempotente (COALESCE backfill), `addSource(prospectId, source)` con upsert sugli indici unici parziali (P4) — i conflict target **devono** ripetere la clausola `WHERE` dell'indice (`ON CONFLICT(prospect_id, kind, post_id) WHERE post_id IS NOT NULL DO UPDATE …`, idem per `company_id`, e `ON CONFLICT(prospect_id, kind) WHERE post_id IS NULL AND company_id IS NULL` per `manual`; SQLite 3.49 in bundle lo supporta), `listInbox({q, source?, postId?, fit?, icpId?, sort: 'recent'|'comments_first'|'most_interactions', includeDiscarded, page})` con `latest_analysis` (dell'`icpId` passato; senza `icpId`, la più recente di qualsiasi ICP; grezza con `input_hash`) — il filtro `fit` si applica **solo** entro l'`icpId` indicato, così con 2 ICP non si mescolano analisi diverse e conteggio sources per riga, `searchProspects(filters)` (q, status[], listId, **companyId**, hasEmail, enriched, fit, page/pageSize ≤ 100), `idsByFilters(filters, cap=500)` che accetta **gli stessi filtri** di `listInbox`/`searchProspects`. `lists.ts`: CRUD (FK icp), `PATCH` con `archived_at` (archiviata = nascosta + job rifiutati con `blocker`), `addMembers(listId, prospectIds[])` idempotente → `{added, skipped}`, `removeMembers`, `listMembers(listId, filters)` con conteggi per stato. `activities.ts`: `addTouchpoint(prospectId, {listId?, channel, direction, occurredAt, body?, note?, newStatus?})` (+ `status_change` in transazione), `addNote`, `deleteActivity(id)` (solo `touchpoint`/`note`), `timeline(prospectId)` desc. Endpoint: `GET /api/inbox`, `GET /api/inbox/ids`, `GET /api/prospects`, `GET /api/prospects/:id` (con `sources`, `memberships`, `latest_analysis` per ICP **grezza** con `input_hash` — `stale` lo calcola T11, `timeline`), `PATCH /api/prospects/:id`, `POST /api/prospects/:id/status`, `POST /api/prospects/:id/touchpoints`, `POST /api/prospects/:id/notes`, `DELETE /api/activities/:id`, `POST /api/prospects/bulk/status {prospectIds, status, note?}`, `GET/POST/PATCH /api/lists`, `GET /api/lists/:id`, `GET /api/lists/:id/members/ids`, `POST /api/lists/:id/members {prospectIds[]}`, `DELETE /api/lists/:id/members {prospectIds[]}`.
- **validation**: bulk add di 3 prospect di cui 1 già membro → `{added:2, skipped:1}`; `POST status 'contattato'` → timeline ha `status_change` from/to; touchpoint con `newStatus` → 2 attività nella stessa transazione; Inbox esclude membri e `scartato` salvo `includeDiscarded`; `bulk/status → nuovo` ripristina; `DELETE /api/activities/:id` su `status_change` → 409.
- **status**: Done
- **log**:
  - 2026-09-16 (W2, worker): `db/prospects.ts` → `upsertProspect(input, {refresh?}) → {id, created}` (default backfill: riempie solo i vuoti; `refresh:true` fa vincere i nuovi valori non vuoti; mai sovrascrive con null/''), `addSource(prospectId, {kind, postId?, companyId?, reactionType?, commentText?, raw?}) → {id, created}` (lookup + `ON CONFLICT(...) WHERE <clausola indice> DO UPDATE` con COALESCE, `captured_at` della prima cattura), `updateProspect`, `prospectExists`, `getProspect`, `searchProspects(query)`, `listInbox(query)`, `idsByFilters(query, cap=500) → {ids, total, capped}`, tipi `ProspectQuery`, `ProspectQueryError`, `PROSPECT_SORTS`, `FIT_FILTERS`, `IDS_CAP`, `MAX_PAGE_SIZE`, `EDITABLE_PROSPECT_FIELDS`. `db/lists.ts` → `getList`, `listExists`, `isListArchived` (false anche se inesistente), `listLists({includeArchived?})`, `createList` (null se ICP inesistente), `updateList`, `addMembers → {added, skipped, not_found}`, `removeMembers → {removed}`, `listMembers`. `db/activities.ts` → `addActivity({prospectId, kind, …, meta?})`, `changeStatus(prospectId, to, {note?, listId?, occurredAt?, meta?}) → {changed, from, to, activity}|null`, `addTouchpoint`, `addNote`, `deleteActivity → 'deleted'|'not_found'|'not_deletable'`, `timeline`, `getActivity`. `domain/status.ts` → `STATUS_LABELS`, `isTerminal`, `isProspectStatus`, re-export `changeStatus`.
  - Payload: riga tabella (`GET /api/inbox`, `GET /api/prospects` → `{items, total, page, pageSize}`, default 50, max 100) = colonne prospect **senza `about`/`raw_json`** + `has_email`, `sources_count`, `source_kinds[]`, `source_counts{}`, `last_captured_at`, `last_touchpoint_at`, `sources[]` (post_url, post_excerpt ≤120, company_name, reaction_type, comment_text ≤280), `latest_analysis {id, icp_id, icp_name, summary, fit, fit_reason, input_hash, created_at}|null`, `memberships[] {list_id, list_name, icp_id, icp_name, added_at, archived_at}`. Dettaglio `GET /api/prospects/:id` = tutte le colonne + `raw` + `sources[]` completi + `memberships[]` + `latest_analysis` (più recente, con `angles[]`) + `latest_analyses[]` (una per ICP) + `last_touchpoint_at` + `timeline[]`. Attività = `{id, prospect_id, list_id, list_name, kind, channel, direction, from_status, to_status, body, meta, occurred_at, created_at, deletable}`. Lista (item e dettaglio) = `{id, icp_id, name, description, created_at, archived_at, icp{id,name}, members_count, counts_by_status (9 chiavi), enriched_count, with_email_count, analyzed_count}`. Filtri: `status`/`source`/`fit` separati da virgola, `fit=none`; ICP del `fit` = `icpId` → ICP della lista → unico ICP, altrimenti 400 `fit_requires_icp`. `?status=scartato` mostra solo gli scartati. Bulk status → `{updated, unchanged, not_found}`; stesso stato → nessuna attività. Touchpoint con `newStatus`: una transazione, `status_change` scritta prima (il touchpoint sta in cima alla timeline), `meta.note` + `meta.status_change_id`. Extra: `GET /api/prospects/ids` (per T19), `sort=fit`, `listId` opzionale sul bulk status.
  - RED→GREEN: `api-prospects` (`upsertProspect is not a function`) → 12; `api-lists` (404 → 201) → 6; `status-model` → 6 (rollback provato con CHECK fallito). Validazioni del task tutte coperte (+ source idempotente 4 non 8, `fit` per ICP, cap `/ids` 501 → 500 `capped`). Suite completa 17 file / 111 test; typecheck 0 errori.
  - Deviazioni: slice non strettamente uno per volta dopo i due tracer RED (test successivi verdi al primo giro). `addMembers` accetta liste archiviate (FLOW: bloccati solo i job). `routes/lists.ts` importa `readProspectQuery`/`runQuery` da `routes/prospects.ts` (accoppiamento tra router, nessun co-edit). **T9 deve passare `{refresh:true}` in modalità Full** (altrimenti il `raw_json` della reazione resta). Filtri `fit` per rifiutata/errore/non arricchibile (FLOW E.4) rimandati a T11.
- **files edited/created**:
  - created: `src/domain/status.ts`, `src/db/activities.ts`, `src/db/prospects.ts`, `src/db/lists.ts`, `tests/api-prospects.test.ts`, `tests/api-lists.test.ts`, `tests/status-model.test.ts`
  - edited: `src/server/routes/prospects.ts`, `src/server/routes/lists.ts`
- **backlog_item_id**: CRM-S4
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s4
- **relation_mode**: body-links
- **tdd_target**: `tests/api-prospects.test.ts`: `POST /api/prospects/:id/touchpoints {channel:'linkedin_dm', direction:'outbound', body:'Ciao…', newStatus:'contattato'}` → 201; `GET /api/prospects/:id` ha `status==='contattato'` e `timeline` con 2 voci (`touchpoint`, `status_change`) desc.
- **review_mode**: cli

### T6: Controller job generico su tabella `jobs` (+ preview type, retry, deps iniettabili)

- **depends_on**: [T3]
- **location**: `src/db/jobs.ts`, `src/server/jobs.ts`, `src/server/routes/jobs.ts`, `src/server/job-entry.ts`, `src/jobs/deps.ts`, `tests/jobs.test.ts`
- **description**: `startJob(kind, params, opts)`: inserisce riga `jobs` (`running`, pid), spawna `tsx src/server/job-entry.ts <jobId>` (override `command/args` per test), il wrapper legge il job, chiama `HANDLERS[kind](params, deps)` e scrive `succeeded|failed` + `result|error`. `jobs/deps.ts`: `resolveDeps(kind)` è un **puro dispatcher**: se `E2E_FAKE_JOBS=1` ritorna `fakeDeps(kind)` da `jobs/fake-deps.ts` (riempito da T20), altrimenti `realDeps()` importata da `jobs/<kind>.ts` (riempita dal task proprietario di quel kind: T8/T9/T10/T11). T6 **non** scrive alcuna deps reale e non conosce le firme: si appoggia agli stub `Deps`/`realDeps()` creati da T3. Guard: **un solo job `running`** (pid vivo) → altrimenti `409`; pid morto → `failed` con "Run interrotto (processo non più attivo)". `POST /api/jobs/:id/retry` → nuovo job con gli stessi `params` (409 se ne gira uno). Endpoint `GET /api/jobs/current`, `GET /api/jobs?limit=20`, `GET /api/jobs/:id`. Ogni `error` è prefissato per attribuzione: `actor:<id>: …` / `config: …` / `process: …`.
- **validation**: due `POST` concorrenti → il secondo 409; job `command:'node' args:['-e','process.exit(1)']` → `failed` con `error`; job che scrive esito via wrapper → `succeeded` con `result.summary`; `retry` di un job `failed` → nuova riga `running` con `params` identici.
- **status**: Done
- **log**:
  - 2026-09-16 (W2, worker): `Job = {id, kind, params (parsed), state, pid, started_at, finished_at, result: {summary, counts, warnings?}|null (parsed), error, created_at}`. `server/jobs.ts`: `startJob(kind, params, spawnOpts?)` (lancia `JobRunningError`), **`launchJob(c, kind, params)`** → 202 `{job}` o 409 `{error, code:'job_running', job_id}` (i router controllano i propri blocker di config **prima**), **`runningJobBlocker(): string|null`** ("C'è già un job in corso: <kind>, avviato N min fa."), `getCurrentJob()`, `getJob`, `listJobs(limit)` (1..100), `retryJob(id, spawnOpts?)`, `jobHttpError(err)`, `JOB_KIND_LABELS`, `JobNotFoundError`, `JobNotRetryableError`. `db/jobs.ts`: `insertJob`, `findJob`, `findLatestJob`, `findRunningJobs`, `findJobs`, `setJobPid`, `completeJob`, `failIfRunning`. `server/job-entry.ts`: `runJob(jobId, {handlers?, resolveDeps?})` (in-process, l'esito del wrapper vince; no-op se la riga non è più `running`), `attributeError(err)` (mantiene `actor:`/`config:`/`process:`, altrimenti prefissa `process: `); CLI solo se entry point, exit forzato ≤ 500 ms dopo l'esito. `jobs/deps.ts`: `resolveDeps(kind)` (`E2E_FAKE_JOBS==='1'` letto a ogni chiamata).
  - Endpoint: `GET /api/jobs/current` → `{job}` = job in corso **o l'ultimo terminato** (il banner ritrova l'esito dopo un reload); `GET /api/jobs?limit=` → `{items}`; `GET /api/jobs/:id`; `POST /api/jobs/:id/retry` → 202 `{job}` / 404 / 409 `job_running` / 409 `job_not_failed`. Spawn default `node_modules/.bin/tsx src/server/job-entry.ts <jobId>` da ROOT con env del padre + `JOB_ID`; con override `opts.jobs` l'id è l'ultimo argomento e `JOB_ID`.
  - RED→GREEN: modulo `server/jobs.js` assente → poi `runningJobBlocker`/`job-entry`/`launchJob` assenti → 11/11 verdi (3 run stabili). Validazioni: 2 POST concorrenti → `[202, 409]`; `process.exit(1)` → `failed` `/^process: .*exit 1/`; esito scritto dal wrapper → `succeeded` (in-process e con figlio reale); retry di `failed` → nuova riga `running` con `params` identici; pid morto → `failed`. Smoke one-off dello spawn reale con `E2E_FAKE_JOBS=1` su DB scratch: `failed` in 205 ms con `process: Non ancora implementato: deps fake… (T20)` (env propagato al figlio). Verifica orchestratore: `jobs.test.ts` + test T4 → 25/25.
  - Deviazioni: testi 409 e crash presi dal FLOW invece della frase del brief (stesso `code`); **retry di job `succeeded` non consentito** (FLOW offre Riprova solo sui falliti). Test `resolveDeps` confronta i due percorsi senza asserire `NotImplementedError` (T20 lo romperebbe).
  - Rischi: check-then-insert non in transazione SQLite (sicuro con un solo processo server). Il pid salvato è quello del launcher `tsx`.
- **files edited/created**:
  - created: `src/db/jobs.ts`, `src/server/jobs.ts` (stesso path del legacy cancellato in T2), `src/server/job-entry.ts`, `src/jobs/deps.ts`, `tests/jobs.test.ts` (stesso path del legacy)
  - edited: `src/server/routes/jobs.ts`
- **backlog_item_id**: CRM-S8
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s8
- **relation_mode**: body-links
- **tdd_target**: `tests/jobs.test.ts`: `startJob('enrich', {prospectIds:[1]}, {command:'node', args:['-e','']})` → riga `running` con pid; alla chiusura del figlio senza esito → `getCurrentJob()` la vede `failed` con `error` che inizia per `process:`.
- **review_mode**: cli

### T7: Adapter actor (reazioni, dipendenti) e mapper puri

- **depends_on**: [T2]
- **location**: `src/apify/actors.ts`, `src/acquisition/mappers/{posts,reactions,employees}.ts`, `src/acquisition/types.ts`, `tests/fixtures/apimaestro-post-reactions.json`, `tests/fixtures/harvestapi-company-employees.json`, `tests/mappers-reactions.test.ts`, `tests/mappers-employees.test.ts`, `tests/post-extract.test.ts` (path aggiornato)
- **description**: `ACTORS.postReactions = 'apimaestro/linkedin-post-reactions'` con `postReactionsInput(postUrls: string[], {pageNumber, limit=100})` (**batch** di URL); `ACTORS.companyEmployees = 'harvestapi/linkedin-company-employees'` con `companyEmployeesInput(companyUrls, {jobTitles, locations, maxItems, mode})` — **prima** di scrivere il builder, leggere l'input-schema reale (URL in §7) e riportare i nomi campo letterali in commento. Mapper puri con `field()`: `mapReactions(items) → Array<RawCandidate & {kind:'post_reaction', reactionType, postUrl}>` (raggruppabili per `_metadata.post_url`; scarta senza `reactor.profile_url` normalizzabile, conta gli scarti), `mapEmployees(items) → Array<RawCandidate & {kind:'company_employees', title, location, about?, experience?}>` tollerante ai layout piatto/annidato. Sposta `post-extract.ts` in `acquisition/mappers/posts.ts` mantenendo gli export `extractPost`, `mapComment`, `mapComments` (+ `commentText` sul candidato) e **rimuovendo** `mapTaggedPerson`/`TaggedPerson` (feature gated-off del vecchio sistema; i relativi blocchi in `tests/post-extract.test.ts` si cancellano). `RawCandidate` in `acquisition/types.ts`; cancella `src/strategies/`.
- **validation**: fixture reazioni (3 item, 1 senza URL) → 2 candidati con `reactionType` e `skipped:1`; fixture dipendenti → candidati con url/nome/headline/title e `about` quando presente; `postReactionsInput(['a','b'], {pageNumber:2})` → `{post_urls:['a','b'], page_number:2, limit:100}`.
- **status**: Done
- **log**:
  - 2026-09-16 (W1/W2, worker, in parallelo a T3): nomi campo input **confermati** via endpoint pubblico Apify (read-only, nessuna run, token non usato): harvestapi build 0.0.158 → `companies`, `jobTitles`, `locations`, `maxItems`, `profileScraperMode` con valori letterali `'Short ($4 per 1k)'`/`'Full ($8 per 1k)'`/`'Full + email search ($12 per 1k)'` (default actor = Full, il builder invia sempre il modo, default `Short`); apimaestro post-reactions build 0.1.27 → `post_urls`, `page_number`, `limit` (1–100), `reaction_type`. Commento con fonte/data sopra i builder.
  - Export: `ACTORS.postReactions`, `ACTORS.companyEmployees`, `postReactionsInput(postUrls, {pageNumber=1, limit=100})`, `type EmployeesMode = 'Short'|'Full'|'Full+email'`, `companyEmployeesInput(companyUrls, {jobTitles?, locations?, maxItems, mode?})` (`maxItems` obbligatorio: 0 = tutti fino a 2.500). Tipi in `acquisition/types.ts`: `CandidateKind`, `RawCandidate {linkedinUrl, fullName?, headline?, raw}`, `ReactionCandidate {kind:'post_reaction', reactionType?, postUrl?}`, `CommentCandidate {kind:'post_comment', commentText?, postUrl?}`, `EmployeeCandidate {kind:'company_employees', title?, companyName?, location?, about?, experience?, email?}`, `MapResult<T> {candidates, skipped}`. Mapper: `mapReactions(items) → {candidates, skipped, itemsByPost}` (`itemsByPost` conta gli item letti per `_metadata.post_url`, scarti inclusi: serve a T8 per la fine paginazione), `mapEmployees(items) → MapResult` (layout Full/Short/piatto), `extractPost(item) → {activityId?, postUrl?, text?, postedAt?, reactionsCount?, commentsCount?, companies}`, `mapComment(item, postUrl?)`, `mapComments(items, postUrl?)` (array; scarti = `items.length - result.length`). Rimossi `mapTaggedPerson`/`TaggedPerson`/`sourceDetail`/`sourcePostUrl`; `src/strategies/` cancellata.
  - RED→GREEN: `mappers-reactions` 4 fail (modulo assente) → 4 pass; builder 5 fail → pass; `mappers-employees` 6 fail → 6 pass; `post-extract` 9 fail (nuovo path) → 9 pass. Suite completa 9 file / 61 test verdi; typecheck 0 errori. Verifica orchestratore sui 4 file: 28/28.
  - Gotcha: `reactor.profile_url` usa spesso la forma URN (`/in/ACoAA…`) mentre i commentatori arrivano con lo slug → la stessa persona che reagisce e commenta può diventare 2 prospect nei dati reali (URN conservato in `raw`). harvestapi addebita anche **$0,02 di start fee per run** (T9 preview). Non confermati: layout output modalità Short e nome campo email in Full+email (smoke manuale `maxItems:3` consigliato).
- **files edited/created**:
  - created: `src/acquisition/types.ts`, `src/acquisition/mappers/{posts,reactions,employees}.ts`, `tests/fixtures/apimaestro-post-reactions.json`, `tests/fixtures/harvestapi-company-employees.json`, `tests/mappers-reactions.test.ts`, `tests/mappers-employees.test.ts`
  - edited: `src/apify/actors.ts`, `tests/post-extract.test.ts`, `tests/apimaestro-actors.test.ts` (extra autorizzato: test dei nuovi builder)
  - deleted: `src/strategies/post-extract.ts`, `src/strategies/types.ts` (cartella rimossa)
- **backlog_item_id**: CRM-S2
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s2
- **relation_mode**: body-links
- **tdd_target**: `tests/mappers-reactions.test.ts`: `mapReactions(fixture)` ritorna 2 candidati con `linkedinUrl` normalizzato, `reactionType:'LIKE'|'PRAISE'`, `kind:'post_reaction'`, `postUrl` da `_metadata`, e l'item senza `profile_url` è escluso.
- **review_mode**: cli

### T8: Job "Sync interazioni" (miei post → reazioni + commenti → Inbox)

- **depends_on**: [T5, T6, T7]
- **location**: `src/jobs/sync-interactions.ts`, `src/db/posts.ts`, `src/server/routes/sync.ts`, `tests/sync-interactions.test.ts`
- **description**: In `jobs/sync-interactions.ts` (stub di T3) definisce `Deps` (`fetchPosts`, `fetchReactions(postUrls[], page)`, `fetchComments(activityId)`, `now`, config) e riempie **`realDeps()`** con `runActor` + i builder di T7 (`profilePostsApimaestroInput`, `postReactionsInput`, `postCommentsInput`) e **`handler`**. `syncInteractions(params: {force?, postsOnly?}, deps)` è puro rispetto all'I/O. Passi: legge `own_profile_url` (assente → errore `config:` — ma la preview lo espone come `blocker`, quindi non dovrebbe accadere); scarica fino a `postsPerSync` post → upsert `posts`; se `postsOnly` si ferma qui; seleziona i post **da sincronizzare** secondo P6 (mai sincronizzati; oppure `last_synced_at` > `syncCooldownDays` e post entro `postRecencyDays`; oppure `force`); reazioni in **batch** per pagina fino a `reactionsPerPost` per post; commenti per post; per ogni candidato `upsertProspect({…, memberUrn}, {linkByName: true})` + `addSource` (idempotente), **senza** membership (P1); `prospects_new`/`prospects_seen` da `created`, gli eventuali `mergedIds` sommati in `counts.prospects_merged` *(steering identità)*. Errori per-post isolati (`post_errors`). Aggiorna `last_synced_at` **solo** se il post non è "sospetto" (`reactions_count > 0` e 0 lette → `warnings`). `result`: `{summary, counts:{posts, posts_synced, posts_skipped_fresh, reactions, comments, prospects_new, prospects_seen, skipped_no_url, post_errors}, warnings}`. Endpoint `GET /api/sync/preview` → `JobPreview` con `counts:{posts_known, posts_to_sync, reactions_max}`, `est_cost_usd` (`null` al primo sync con nota in `warnings`: "Prima sincronizzazione: stima disponibile dopo `postsOnly`"), `blockers` (profilo mancante, token Apify mancante, job in corso). `POST /api/sync/interactions {force?, postsOnly?}` → 202 (400 se `blockers`). `GET /api/posts`.
- **validation**: deps fake (2 post, 150 reazioni paginate 100+50, 3 commenti, 1 reattore anche commentatore) → prospect = reattori∪commentatori senza doppioni, `sources` = 153, Inbox li mostra; *(steering identità)* un reattore con `profile_url` in forma id membro (`/in/ACoAA…`, `reactor.urn`) che commenta con lo slug e **stesso nome e headline** → **1** prospect con `linkedin_url` = slug e `member_urn` valorizzato; **secondo sync** senza `force` entro il cooldown → `fetchReactions` 0 chiamate, `posts_skipped_fresh:2`; con `now` avanzato di 8 gg → ri-scaricati; post con `reactions_count:30` e 0 reazioni lette → `warnings.length===1` e `last_synced_at` invariato; preview senza profilo → `blockers` non vuoto.
- **status**: Done
- **log**:
  - 2026-09-16 (W3, worker): `jobs/sync-interactions.ts` → `Deps = {fetchPosts(profileUrl, totalPosts?), fetchReactions(postUrls, page, limit?), fetchComments(postRef, limit?), now?(), config?: Partial<SyncConfig>}` (T20: `fetchReactions(['u'], 1)` basta), `syncInteractions(params, deps)`, `previewSync`, `syncDecision`/`shouldSync` (P6), `syncConfig`, `REACTIONS_PAGE_MAX`, tipi `SyncParams`, `SyncResult`, `SyncCounts`, `SyncDecision`; `realDeps()` con `runActor` + builder T7 (token mancante → `config:`). `db/posts.ts` (upsert per `post_url`, fallback `activity_id`). Passi: fino a `postsPerSync` post (repost saltati → `reposts_skipped`; `postsOnly` si ferma qui); reazioni **in batch** per pagina (`min(100, reactionsPerPost)`), post esaurito con pagina corta o cap (`posts_capped`), item → post per URL esatto / activity id / unico post del batch; commenti per post (`activity_id`, `min(100, commentsPerPost)`). Ogni candidato: `upsertProspect({linkedinUrl, memberUrn, fullName, headline}, {linkByName: true})` + `addSource`, nessuna membership; pagina salvata in una transazione. Counts `prospects_new`/`prospects_seen` = persone distinte (id uniti esclusi) + `prospects_merged`. Errori per post in `errors[] {post_url, error}` + `post_errors` (non marcati); fallimento `fetchPosts` → job `failed` `actor:apimaestro/linkedin-profile-posts: Impossibile leggere i post di <url> (…). Nessun dato modificato.`; profilo mancante → `config:`. Post con reazioni dichiarate e 0 lette → 1 warning aggregato, `last_synced_at` invariato. Summary FLOW B.4.
  - Endpoint: `GET /api/sync/preview?force=&postsOnly=` → `JobPreview` (`counts: {posts_known, posts_to_sync, reactions_max, posts_per_sync, posts_never_synced, posts_resync, posts_skipped_fresh, posts_skipped_old, reactions_per_post, comments_max}`, `est_cost_usd` null al primo sync con warning "Prima sincronizzazione: stima non disponibile…" o con conteggi ignoti, `blockers`: profilo, token, job in corso). `POST /api/sync/interactions {force?, postsOnly?, __fixture?}` → 202 `{job}`; 400 `{error, code:'blocked', blockers}` solo per blocchi di config; job in corso → 409 `job_running` da `launchJob`; body vuoto = `{}`. `GET /api/posts` → `{items}` (colonne + `reactions_read`, `comments_read`, `prospects_count`, `sync_state: synced|to_sync|archived|error`, `sync_error` dall'ultimo sync riuscito), ordinati per `posted_at` desc.
  - Validazione: RED `syncInteractions is not a function` / API 404 → 19 test: 2 post, 150 reazioni 100+50 (chiamate `[[A,B],1]` poi `[[A],2]`), 3 commenti, 1 persona in entrambi → `prospects=152`, `sources=153`, 0 membership, Inbox 152; steering identità: reattore `/in/ACoAA…` + `reactor.urn` che commenta con lo slug, stesso nome+headline → 1 prospect con slug e `member_urn`, 2 fonti, in entrambi gli ordini (mutation: senza `linkByName` i 2 test falliscono); re-sync nel cooldown → `fetchReactions` 0 chiamate, `posts_skipped_fresh:2`; `now`+8 gg → ri-scaricato (93 gg → `posts_skipped_old:1`); `reactions_count:30` con 0 lette → 1 warning, `last_synced_at` null; preview senza profilo → blocker e POST 400 senza job. Suite 21 file / 180 test; typecheck 0 errori.
  - Deviazioni/gotcha: `raw` dell'item **non** passato a `upsertProspect` (resta in `sources.raw_json`, così l'enrichment T10 scrive `prospects.raw_json`). Post mai sincronizzato: sincronizzato una volta a qualunque età (recency solo per il re-sync); `posted_at` illeggibile → mai re-sync senza `force`. Ultima pagina reazioni troncata localmente ma pagata intera dall'actor (cap non multiplo di 100). 409 per job in corso: pattern adottato poi dall'orchestratore anche in T9/T10 (vedi IMPLEMENTATION-NOTES).
- **files edited/created**:
  - edited: `src/jobs/sync-interactions.ts`, `src/server/routes/sync.ts`
  - created: `src/db/posts.ts`, `tests/sync-interactions.test.ts`
- **backlog_item_id**: CRM-S2
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s2
- **relation_mode**: body-links
- **tdd_target**: `tests/sync-interactions.test.ts`: fake `fetchReactions` che ritorna 100 poi 50 item per il post A → `counts.reactions===150`, `fetchReactions` chiamata 2 volte con `postUrls` in batch; una persona sia reazione che commento → **1** prospect con **2** sources; rilancio immediato → `fetchReactions` non chiamata.
- **review_mode**: cli

### T9: Job "Sourcing da azienda" (URL company → persone → lista)

- **depends_on**: [T4, T5, T6, T7]
- **location**: `src/jobs/source-company.ts`, `src/server/routes/companies.ts` (estende T4: stesso proprietario logico, eseguito **dopo** T4), `tests/source-company.test.ts`
- **description**: In `jobs/source-company.ts` (stub di T3) definisce `Deps` (`fetchEmployees(companyUrl, filters)`) e riempie **`realDeps()`** (`runActor` + `companyEmployeesInput` di T7) e **`handler`**. `sourceCompany({companyId, listId, roles?, maxItems, mode}, deps)`: risolve azienda e lista (archiviata → errore `config:`), usa `roles` passati o `target_roles` dell'ICP della lista; `fetchEmployees(companyUrl, filters)`; per ogni candidato `upsertProspect` (con `memberUrn` del candidato, `company_id`, `title`; se `mode` Full/Full+email e l'item ha about/esperienze → `enriched_at` + `raw_json`, P10), `addSource(kind:'company_employees')`, `addMembers(listId, …)` (P2). `result.counts:{fetched, prospects_new, prospects_seen, added_to_list, marked_enriched, skipped_no_url}`. Endpoint `GET /api/companies/:id/source/preview?listId=&mode=&maxItems=` → `JobPreview` (`counts:{max_items}`, `est_cost_usd` da tariffa modalità, `warnings` se l'ICP non ha `target_roles`, `blockers`: token, job in corso, lista archiviata); `POST /api/companies/:id/source {listId, roles?, maxItems?, mode?}` → 202; `POST /api/companies/from-url {url, icpId?, outcome?}` crea l'azienda (o ritorna l'esistente) e opzionalmente il riferimento ICP; la pagina Aziende (T19) accetta `?listId=` per pre-selezionare la lista nel dialog di sourcing (ingresso "Estrai da un'azienda" dalla Lista vuota, FLOW D.1).
- **validation**: fake `fetchEmployees` 5 item (1 senza URL, 1 già prospect) → lista con 4 membri, `prospects_new:3`, `skipped_no_url:1`; ICP con `target_roles` → `roles` passati coincidono; `mode:'Full'` con about → `marked_enriched` > 0; preview su ICP senza ruoli → `warnings` non vuoto.
- **status**: Done
- **log**:
  - 2026-09-16 (W3, worker): `jobs/source-company.ts` → `Deps = {fetchEmployees(companyUrl, {jobTitles, locations, maxItems, mode}) → item[]}`, `sourceCompany(params, deps)`, `SourceCompanyParams {companyId, listId, roles?, locations?, maxItems?, mode?}`, `resolveFilters`, `estimateSourcingCostUsd` (`maxItems/1000 × tariffa + EMPLOYEES_RUN_START_USD 0.02`), `EMPLOYEES_MAX_ITEMS` 2500, `archivedListText`; `realDeps()` = `runActor` + `companyEmployeesInput` (token mancante → `config:`). Per candidato: `upsertProspect({…, memberUrn, companyId, title, location, email}, {refresh: mode≠Short})`, P10 (about/esperienze in Full → `enriched_at` + `raw_json` con la busta di profile-detail `{source, experience, education, certifications}`), `addSource(company_employees)`, `addMembers`. `result.counts: {fetched, prospects_new, prospects_seen, prospects_merged, added_to_list, already_in_list, marked_enriched, skipped_no_url}`; summary FLOW D.3 (zero neutro con suggerimento sui filtri). Errori: azienda/lista mancante o archiviata → `config:`; actor → `actor:harvestapi/linkedin-company-employees: …`.
  - Endpoint (in `routes/companies.ts`, solo aggiunte): `GET /api/companies/:id/source/preview?listId=&mode=&maxItems=&roles=` → `JobPreview {counts:{max_items}, est_cost_usd, warnings (ICP senza ruoli), blockers (token, job in corso, lista mancante/inesistente/archiviata)}`; 404 azienda, 400 `mode`/`maxItems` fuori 1–2500. `POST /api/companies/:id/source {listId, roles?, locations?, maxItems?, mode?}` → 202 `{job}` con filtri risolti al lancio (retry identico), 400 `{error, code:'blocked', blockers}`. `POST /api/companies/from-url {url, icpId?, outcome?}` → 201 creata / 200 esistente (`Company & {created}`), riferimento ICP opzionale; 400 `invalid_company_url` / `icp_not_found` / `outcome` senza `icpId`.
  - Validazione: RED `sourceCompany is not a function` → 12 test verdi (tdd_target `jobTitles:['CTO']` + lista con 4 membri `nuovo`; 5 item → `prospects_new:3, prospects_seen:1, added_to_list:4, skipped_no_url:1`; Full con about → `marked_enriched:1`; preview ICP senza ruoli → warning; identità: reazione solo-id + commento slug + sourcing con entrambe le chiavi → `prospects_merged:1`). Suite 21 file / 147 test; typecheck 0 errori (verifica orchestratore al gate W3).
  - Gotcha: job in corso = blocker di preview → la POST risponde 400 `blocked` (409 `job_running` solo in race): T13 gestisce entrambi. Stima Short 50 = $0,22 (T19 e FLOW D.2 aggiornati). Extra oltre il piano: `locations` nel body (FLOW D.2), `roles` in query alla preview, `already_in_list`/`prospects_merged`. `from-url` non accetta `listId` (FLOW D.1 lo cita: vale il PLAN). Nessun try/catch per persona: un errore DB su una persona fallisce il job (le precedenti restano).
- **files edited/created**:
  - edited: `src/jobs/source-company.ts`, `src/server/routes/companies.ts`
  - created: `tests/source-company.test.ts`
- **backlog_item_id**: CRM-S3
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s3
- **relation_mode**: body-links
- **tdd_target**: `tests/source-company.test.ts`: lista L (ICP `target_roles:['CTO']`), `sourceCompany({companyId, listId:L}, {fetchEmployees: fake})` → il fake riceve `jobTitles:['CTO']` e `GET /api/lists/L` ha 4 membri `status:'nuovo'`.
- **review_mode**: cli

### T10: Enrichment on-demand (single, selezione, lista)

- **depends_on**: [T5, T6]
- **location**: `src/enrich/profile-detail.ts` (riuso), `src/jobs/enrich.ts`, `src/server/routes/enrich.ts`, `tests/enrich-prospects.test.ts`
- **description**: In `jobs/enrich.ts` (stub di T3) definisce `Deps` (`enrich(urls) → Map<url, Enrichment>`) e riempie **`realDeps()`** (= `enrichProfileDetails`) e **`handler`**. `enrichProspects({prospectIds} | {listId, onlyMissing}, {retryFailed?}, deps)`: target = `enriched_at IS NULL` e (`enrichment_attempted_at` nullo o più vecchio di `freshnessDays`; con `retryFailed` anche i tentati di recente senza esito); chiama `enrichProfileDetails` (riuso) e applica con COALESCE, stampa `enrichment_attempted_at` sempre e `enriched_at` solo se l'item torna; *(steering identità)* l'URL canonico restituito dall'actor (URN → slug) e l'eventuale id membro (`basic_info.urn`, lettura tollerante in `mapProfileDetailItem`) vanno applicati con `setProspectIdentity(id, {linkedinUrl, memberUrn})` (`src/db/identity.ts`): il prospect arricchito resta e assorbe un eventuale duplicato con lo stesso slug; attività `enrichment` con esito; aggancia `company_id` se `company_name` matcha (best-effort). Esporta anche `enrichOneInline(prospectId, deps)` (sincrono, per `enrichFirst` di T11). `result.counts:{targets, enriched, no_data, with_email, skipped_fresh}`. Endpoint: `POST /api/prospects/:id/enrich` (202 job), `POST /api/enrich {prospectIds[]}` (202), `POST /api/lists/:id/enrich {onlyMissing}` (202), `GET /api/enrich/preview?prospectIds=|listId=` → `JobPreview` (`est_cost_usd` = `targets × PRICE_PROFILE_DETAIL_USD` o `null`).
- **validation**: 3 prospect, fake che ritorna dati per 2 → `enriched:2, no_data:1`, tutti con `enrichment_attempted_at`; re-run → `skipped_fresh:1`; `email` pre-esistente non azzerata; preview con prezzo `null` → `est_cost_usd:null` e warning "stima non disponibile".
- **status**: Done
- **log**:
  - 2026-09-16 (W3, worker): `jobs/enrich.ts` → `Deps = {enrich(urls) → Promise<Map<url, Enrichment>>}`, `EnrichParams` (`{prospectIds}` | `{listId}` + `onlyMissing?` default true, `retryFailed?` default false), `planEnrichment(params, now?)`, `estimateEnrichCostUsd(targets)`, `enrichProspects(params, deps)` (2 argomenti: `retryFailed` sta nei params), `enrichOneInline(prospectId, deps, {timeoutMs?}) → EnrichOneResult {prospectId, outcome:'enriched'|'no_data'|'error'|'not_found', withEmail, mergedIds, error?}` (non lancia su errori provider/config; ignora freschezza; `prospectId` sopravvive sempre al merge; timeout → `error` senza scritture), `handler`, `realDeps()` (token verificato a ogni chiamata → `config:`). Un profilo per chiamata a `config.enrichConcurrency`: errori isolati per item.
  - Applicazione: `setProspectIdentity(id, {linkedinUrl: canonicalUrl, memberUrn})` prima di tutto (steering identità), poi campi profilo (nome, headline, about, location, company_name, title, raw_json) coi valori nuovi non vuoti; email/telefono/`company_id` solo se mancanti; `enrichment_attempted_at` sempre, `enriched_at` solo con dati; attività `enrichment` con `meta.outcome`. `company_id` best-effort per URL azienda o nome esatto univoco. `profile-detail.ts`: `Enrichment` + `canonicalUrl`, `memberUrn`, `companyUrl`, `title`; concorrenza da config; errori `actor:apimaestro/linkedin-profile-detail: …`. `result.counts: {selected, targets, enriched, no_data, with_email, errors, skipped_enriched, skipped_fresh, not_found, prospects_merged}`; tutti gli item in errore → job `failed` con `actor:`; `config:` ferma subito.
  - Endpoint: `GET /api/enrich/preview?prospectIds=1,2|listId=&onlyMissing=&retryFailed=` → `JobPreview` (`counts:{selected, targets, skipped_enriched, skipped_fresh, not_found}`, `est_cost_usd` null + warning "stima non disponibile" se prezzo null); `POST /api/prospects/:id/enrich`, `POST /api/enrich {prospectIds[]}`, `POST /api/lists/:id/enrich {onlyMissing?, retryFailed?}` → 202 `{job}` con flag espliciti nei params (retry identico); 400 `{error, code:'blocked', blockers}` (token, job in corso, lista archiviata), 404 prospect/lista, 400 `invalid_scope`.
  - Validazione: RED `enrichProspects is not a function` / 5 API 404 → `enrich-prospects` 19 test + `profile-detail` 7: 3 prospect con dati per 2 → `enriched:2, no_data:1`, tutti con `enrichment_attempted_at`, `a.email==='a@x.it'`; re-run → `skipped_fresh:1` (e `skipped_enriched`), provider non chiamato; email/telefono mai azzerati; preview prezzo null → `est_cost_usd:null` + warning; identità: A `/in/ACoAA…` + B slug con fonte e lista → 1 prospect con id A, slug, `member_urn`, fonti/membership di B spostate, `prospects_merged:1`. Suite 21 file / 179 test (con T8 in corso); typecheck 0 errori. Ri-verifica orchestratore: identity + T9 + T10 53/53.
  - Deviazioni: errore provider **non** stampa `enrichment_attempted_at` (riprovato al prossimo giro, la UI non lo mostra come "non arricchibile"; attività con `meta.error`) — il PLAN diceva "sempre". Preview solo `GET /api/enrich/preview?listId=` (FLOW E.2 cita `/api/lists/:id/enrich/preview`: vale il PLAN, nessun alias). Prospect unito via da un altro item durante la chiamata → saltato (contato in `prospects_merged`). T20: `fakeDeps('enrich')` = `{enrich(urls) → Map}`, qualsiasi chiave va bene con un solo URL.
- **files edited/created**:
  - edited: `src/jobs/enrich.ts`, `src/server/routes/enrich.ts`, `src/enrich/profile-detail.ts`, `tests/profile-detail.test.ts`
  - created: `tests/enrich-prospects.test.ts`
- **backlog_item_id**: CRM-S8
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s8
- **relation_mode**: body-links
- **tdd_target**: `tests/enrich-prospects.test.ts`: `enrichProspects({prospectIds:[a,b,c]}, {enrich: fake→{a:{about:'…', email:'a@x.it'}, b:{about:'…'}}})` → `counts.enriched===2`, `c` ha `enrichment_attempted_at` e `enriched_at===null`, `a.email==='a@x.it'`.
- **review_mode**: cli

### T11: Analisi AI del prospect (structured outputs; single sincrona, bulk job su lista o selezione)

- **depends_on**: [T4, T5, T6, T10]
- **location**: `src/analysis/prompt.ts`, `src/analysis/schema.ts`, `src/analysis/analyze.ts`, `src/db/analyses.ts`, `src/jobs/analyze.ts`, `src/server/routes/analyze.ts`, `tests/analyze.test.ts`, `tests/analysis-prompt.test.ts`
- **description**: `schema.ts`: zod `AnalysisSchema {summary ≤600, angles ×3 {title, rationale}, fit 'alto'|'medio'|'basso', fit_reason}` + JSON schema per `output_config.format`. `prompt.ts`: `buildAnalysisInput(ctx)` puro → `{system, user, inputHash}` con azienda utente, ICP (descrizione, ruoli, settori, pains, aziende di riferimento con esito), prospect (headline, about, esperienze da `raw_json`, location, azienda) e **segnali di provenienza** (post reagiti/commentati con testo del commento); consegna: riassunto neutro, 3 angoli concreti ancorati a bio/esperienze/segnali, fit onesto. In `jobs/analyze.ts` (stub di T3) definisce `Deps` (`client` Anthropic, `enrich` deps di T10) e riempie **`realDeps()`** e **`handler`**. `analyze.ts`: `analyzeProspect(prospectId, icpId, {client, force?, enrichFirst?})`: se non arricchito e `enrichFirst` → `enrichOneInline` (T10, budget 120 s) poi prosegue, altrimenti errore `not_enriched`; skip se `input_hash` uguale e non `force`; `client.messages.create({model, max_tokens: 4000, system, messages, output_config:{format:{type:'json_schema', schema}}}, {signal})` dove `signal = AbortSignal.timeout(90_000)` è **una sola deadline condivisa** tra primo tentativo e retry (budget totale della richiesta sincrona ≤ 120 s enrich + 90 s Claude = 210 s, sotto il `requestTimeout` 300 s di T3 anche nel caso peggiore) (con `analysisStructured=false` → istruzione JSON-only nel prompt); parse zod, **1 retry** su parse fallito; `stop_reason 'refusal'|'max_tokens'` → attività `analysis` con `meta.error` e errore leggibile (nessuna riga `analyses`); successo → riga `analyses` + attività `analysis`. Bulk `analyzeMany({listId, onlyMissing, force} | {prospectIds, icpId, force}, deps)` come job: arricchisce prima i mancanti (P5), poi analizza a concorrenza 3; `result.counts:{targets, enriched_first, analyzed, skipped_same_input, not_enrichable, refusals, errors}`. Endpoint: `POST /api/prospects/:id/analyze {icpId, force?, enrichFirst?}` (sincrono; 409 `not_enriched` se manca e non `enrichFirst`; 502 su refusal con messaggio), `POST /api/analyze {prospectIds[], icpId, force?}` (202), `POST /api/lists/:id/analyze {onlyMissing, force}` (202), `GET /api/analyze/preview?listId=|prospectIds=&icpId=&force=` → `JobPreview` (`counts:{to_enrich, to_analyze, skipped_same_input}`, `est_cost_usd`, `blockers`: token Anthropic mancante, job in corso; `warnings`: descrizione azienda vuota). `GET /api/prospects/:id/analyses?icpId=` (in `routes/analyze.ts`, **T11-owned**) → `{latest, stale: boolean, history[]}` dove `stale = latest.input_hash !== hash(buildAnalysisInput(ctx))`: è l'unico punto che calcola `stale` (T5 espone solo `latest_analysis` grezza con `input_hash`); T16 lo consuma.
- **validation**: `client` fake → `analyses` salvata e `GET /api/prospects/:id` ha `latest_analysis.angles.length===3`; JSON invalido una volta poi valido → 1 retry; `stop_reason:'refusal'` → 502, nessuna riga `analyses`, attività con `meta.error`; `buildAnalysisInput` include il testo del commento; prospect non arricchito con `enrichFirst` → chiama la deps di enrichment poi analizza.
- **status**: Done
- **log**:
  - 2026-09-16 (W3, worker): `analysis/schema.ts` → `AnalysisSchema` (summary ≤600, 3 angoli `{title, rationale}`, `fit`, `fit_reason`), `ANALYSIS_JSON_SCHEMA` (`z.toJSONSchema` ripulito dalle keyword non accettate dagli structured outputs, `additionalProperties:false`; limiti imposti dal parse zod), `parseAnalysis(text)`. `analysis/prompt.ts` → `buildAnalysisInput(ctx, {jsonOnly?}) → {system, user, inputHash}` (sha256 system+user; istruzione JSON-only aggiunta **dopo** l'hash; azienda utente, ICP + aziende di riferimento con esito, profilo da `raw_json` `{source, experience, education, certifications}`, segnali di provenienza con testo del commento; il profilo è dato, istruzioni al suo interno ignorate). `analysis/analyze.ts` → `analyzeProspect(prospectId, icpId, {client, enrich?, force?, enrichFirst?, listId?, timeoutMs?, icpContext?}) → AnalyzeResult` (esiti `analyzed | skipped_same_input | not_found | icp_not_found | not_enriched | not_enrichable | enrich_error | failed{errorKind, error, activity}`, non lancia su errori modello/provider; una sola `AbortSignal.timeout(90_000)` per tentativo + retry; `enrichFirst` via `enrichOneInline` 120 s; 401/403 → `config:` senza attività), `AnalysisClient`, `ANALYSIS_MESSAGES` (testi FLOW). `db/analyses.ts` → `loadAnalysisSubject`, `hasProfileData`, `analysisHistory`, `latestAnalysis`, `saveAnalysis` (riga + attività in transazione), `recordAnalysisFailure` (`meta: {icp_id, error, error_kind: refusal|invalid_output|max_tokens|error, model, refusal_category?}`), `latestAnalysisFailure`. `jobs/analyze.ts` → `Deps = {client, enrich}`, `AnalyzeParams` (`{listId, onlyMissing?, force?}` | `{prospectIds, icpId, onlyMissing?, force?}`), `planAnalysis`, `estimateAnalysisCostUsd`, `analyzeMany` (arricchisce prima i mancanti, poi 3 in parallelo; `counts: {selected, targets, enriched_first, analyzed, skipped_same_input, skipped_analyzed, not_enrichable, refusals, errors, not_found, prospects_merged}`), `handler`, `realDeps()` (client Anthropic lazy, chiave verificata a ogni chiamata).
  - Endpoint: `POST /api/prospects/:id/analyze {icpId, force?, enrichFirst?}` → 200 `{outcome, enriched_first, stale:false, analysis}`; 409 `not_enriched`/`not_enrichable`; 502 `refusal`/`invalid_output`/`max_tokens`/`analysis_failed`/`enrich_failed` + `activity_id`; 400 `blocked`/`config`; 404; funziona anche con un job in corso. `GET /api/prospects/:id/analyses?icpId=` → `{icp_id, latest, stale, history, state, last_error:{kind, message, occurred_at, activity_id}|null, analyzable}` (unico punto che calcola `stale`; 400 `icp_required`). `GET /api/analyze/preview?listId=|prospectIds=&icpId=&force=&onlyMissing=` → `JobPreview` + `model`, `counts: {selected, to_enrich, to_analyze, skipped_same_input, skipped_analyzed, not_enrichable, not_found}` (prezzo profilo null → warning "stima arricchimento non disponibile", solo parte analisi). `POST /api/analyze {prospectIds, icpId, onlyMissing?, force?, __fixture?}` e `POST /api/lists/:id/analyze {onlyMissing?, force?}` → 202 `{job}` con flag espliciti; 400 `blocked` solo config (chiave Anthropic, lista archiviata, token Apify se serve arricchire); job in corso → 409 da `launchJob`. Righe tabella (`db/prospects.ts`, extra autorizzato): `analysis_state: alto|medio|basso|rifiutata|errore|non_arricchibile|null` + `analysis_error` per lo stesso ICP di `latest_analysis` (una sola espressione SQL `analysisStateSql` per riga e filtro), `analysisStates(ids, icpId)`; `FIT_FILTERS` + `rifiutata`, `errore`, `non_arricchibile`.
  - Validazione: RED `Cannot find module src/analysis/analyze.js` / endpoint 404 / stato di riga assente → `analyze` 23, `analysis-prompt` 6, `api-prospects` 13: fake → riga `analyses` e `latest_analysis.angles.length===3`; JSON invalido poi valido → 2 chiamate sulla stessa `signal`, 1 riga; `refusal` → 502 testo FLOW, 0 righe, attività `meta.error_kind:'refusal'` + `icp_id`; `user` contiene "Kubernetes" (tdd_target, `fit:'alto'`, 3 angoli); non arricchito + `enrichFirst` → deps enrich chiamata poi `analyzed`. Gate W3 (orchestratore): typecheck 0 errori, 23 file / 211 test, build + typecheck web ok.
  - Deviazioni: `max_tokens` **16 000** invece di 4000 (orchestratore: con Opus 5 il ragionamento conta nel limite; sotto la soglia non-streaming dell'SDK). About compilato a mano = dati di profilo sufficienti (`hasProfileData`: rende possibile il recupero FLOW, allarga P5). `fit=none` ora esclusivo (= nessuno stato di analisi: un `non_arricchibile` non matcha più `none`). Bulk: enrichment tentato di recente senza dati → `not_enrichable` saltato (riprovare con Arricchisci + `retryFailed`); con `onlyMissing` gli analizzati con dati cambiati → `skipped_analyzed` (serve `force`). Nessun refusal fallback lato server (richiede client beta e cambierebbe la semantica 502/`rifiutata`: da decidere). T20/T16: fake `{client:{messages:{create(body, {signal})}}, enrich:{enrich(urls)}}`, refusal = `{content:[], stop_reason:'refusal'}`; l'endpoint sincrono usa `opts.analyzeDeps` o `resolveDeps('analyze')` → 500 in modalità fake finché T20 non riempie `fakeDeps`.
- **files edited/created**:
  - created: `src/analysis/schema.ts`, `src/analysis/prompt.ts`, `src/analysis/analyze.ts`, `src/db/analyses.ts`, `tests/analyze.test.ts`, `tests/analysis-prompt.test.ts`
  - edited: `src/jobs/analyze.ts`, `src/server/routes/analyze.ts`, `src/db/prospects.ts` (extra autorizzato: stato di analisi per riga + filtri FLOW E.4), `tests/api-prospects.test.ts`
- **backlog_item_id**: CRM-S6
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s6
- **relation_mode**: body-links
- **tdd_target**: `tests/analyze.test.ts`: prospect arricchito con source `post_comment` (`comment_text:'Anche noi stiamo migrando a Kubernetes'`), `analyzeProspect(p, icp, {client: fake})` → il `user` message passato al fake contiene "Kubernetes" e la riga `analyses` ha `fit:'alto'` e 3 angoli.
- **review_mode**: cli

### T12: Export CSV per lista (filtri o selezione) con log di attività

- **depends_on**: [T5, T11]
- **location**: `src/exports/list-export.ts` (**non** `src/export/`: quella cartella è cancellata e il `purge-guard` di T2 ne asserisce l'assenza), `src/db/exports.ts`, `src/server/routes/exports.ts`, `src/util/csv.ts` (riuso `toCsv` spostata in T2), `tests/list-export.test.ts`
- **description**: `POST /api/lists/:id/exports {status?: string[], hasEmail?: boolean, prospectIds?: number[], markContacted?: boolean}` (`prospectIds` mutuamente esclusivo con i filtri) → riga `exports`, un'attività `export` per prospect (`meta:{export_id}`) e, solo se `markContacted` (default `false`), `status_change → contattato` nella stessa transazione; ritorna `{id, count, download_url}`. `GET /api/exports/:id.csv` → colonne: `full_name, first_name, last_name, email, company, title, linkedin_url, location, status, list, icp, fit, summary, angle_1, angle_2, angle_3, last_touchpoint_at, sources` (`sources` = "reazione a <url>; commento a <url>; dipendente di <azienda>"); `first_name/last_name` best-effort dal primo spazio. `GET /api/lists/:id/exports` storico.
- **validation**: lista con 3 membri (2 con email), `POST {hasEmail:true}` → `count:2`, CSV 2 righe + header nell'ordine dato, 2 attività `export`; `POST {prospectIds:[x]}` → `count:1`; `angle_*` vuoti se non analizzato; `markContacted:true` → stato dei 2 = `contattato`.
- **status**: Done
- **log**:
  - 2026-09-16 (W4, worker): `POST /api/lists/:id/exports {q?, status?[], enriched?, source?[], fit?[], hasEmail?, prospectIds?[] ≤1000, markContacted?}` → 201 `{id, list_id, scope:'filters'|'selection', filters, selected, mark_contacted, count, created_at, download_url:'/api/exports/<id>.csv', counts:{in_scope, excluded_email, not_found, not_member, marked_contacted, status_unchanged}}`; 400 `selection_with_filters` (solo `hasEmail` ammesso con la selezione, FLOW G), 400 `empty_export` (nessuna scrittura), 404 lista. `GET /api/lists/:id/exports` → `{items}` (desc). Extra: `GET /api/lists/:id/exports/preview?…` → `{count, counts:{in_scope, excluded_email, not_found, not_member, to_mark_contacted}}` senza scritture (conteggio live di FLOW G per T15). `GET /api/exports/:id.csv` → `text/csv; charset=utf-8`, `content-disposition: attachment; filename="<lista>-<data>-export-<id>.csv"`, `no-store` (route Hono `/exports/:file{[0-9]+\.csv}`: `:id.csv` in Hono è un param chiamato `id.csv`).
  - CSV: header `full_name,first_name,last_name,email,company,title,linkedin_url,location,status,list,icp,fit,summary,angle_1,angle_2,angle_3,last_touchpoint_at,sources`; RFC 4180, `\n`, niente BOM; `csv.ts` neutralizza le formule (celle che iniziano con `= + - @ \t \r` → prefisso `'`, numeri come `-5` invariati). `status` = label italiana; `company` = `company_name` o nome azienda collegata; `angle_n` = "titolo — rationale"; `sources` "reazione a <url>; commento a <url>; dipendente di <azienda>" (o "inserito a mano"); `fit/summary/angle_*` solo da `latestAnalysis(prospect, list.icp_id)`. `prospect_ids` congelati all'export (ri-download = stesse persone, valori attuali; uniti/cancellati esclusi). Una transazione: riga export → per prospect `changeStatus(→contattato, {listId, meta:{export_id}})` opzionale → attività `export` (`list_id`, `meta:{export_id, status_change_id?}`). `markContacted` sposta solo `nuovo/qualificato/da_contattare`; gli altri stati (incl. terminali) in `status_unchanged`. Liste archiviate esportabili.
  - Validazione: RED `expected 404 to be 201` → 9 test: 3 membri (2 con email) `{hasEmail:true}` → `count:2`, CSV header esatto + 2 righe, 2 attività `export`; `{prospectIds:[x, estraneo, 999999, x]}` → `count:1` (`not_member:1, not_found:1`); `angle_*` vuoti se non analizzato o analizzato per altro ICP; `markContacted` → 2 `contattato`, secondo export non tocca `risposto/scartato`; rollback su errore a metà (trigger) → 0 righe; formula guard. Suite 25 file / 221 test (1 fallimento di T20 in corso); typecheck 0 errori.
  - Deviazioni: filtri extra della pagina lista (`q, enriched, source, fit`); selezione con id non membri/inesistenti saltati e contati; export vuoto → 400; risposta POST completa invece di `{id, count, download_url}`; nessun limite righe (caricamento a blocchi da 500). Gotcha risolto dall'orchestratore: `.gitignore` `exports/` ignorava anche `src/exports/` → ancorato a `/exports/`.
- **files edited/created**:
  - created: `src/exports/list-export.ts`, `src/db/exports.ts`, `tests/list-export.test.ts`
  - edited: `src/server/routes/exports.ts`, `src/util/csv.ts`, `.gitignore` (orchestratore: `/exports/`)
- **backlog_item_id**: CRM-S7
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s7
- **relation_mode**: body-links
- **tdd_target**: `tests/list-export.test.ts`: `POST /api/lists/L/exports {hasEmail:true}` → 201 `{count:2}`; `GET /api/exports/:id.csv` ha header esatto e 2 righe; il primo esportato ha un'attività `kind:'export'`.
- **review_mode**: cli

### T13: Fondazione frontend (client, tipi, nav, onboarding, JobBanner+retry, JobPreviewDialog, ListPicker)

- **depends_on**: [T4, T5, T6]
- **location**: `web/src/api/client.ts`, `web/src/api/types.ts`, `web/src/routes/__root.tsx`, `web/src/routes/index.tsx`, `web/src/lib/jobs.ts`, `web/src/components/{JobBanner,JobPreviewDialog,SyncDialog,ListPicker,StatusBadge}.tsx`
- **description**: `types.ts` sui payload T4/T5/T6 (Prospect, List, Icp, Company, Activity, Analysis, Job, JobPreview, Readiness); `client.ts` (`ApiError`+`qs` invariati) con tutte le chiamate previste dai task server (anche quelle non ancora implementate: gli stub rispondono 404, il FE le usa solo dalle pagine dei task successivi). Nav: **Inbox · Liste · ICP · Aziende · Impostazioni**. `index.tsx`: onboarding a 3 passi da `settings.readiness` (profilo → ICP → sincronizza) con link diretti; il passo 3 offre anche l'alternativa "Aggiungi un'azienda e cerca le persone" (link a `/companies?add=1`, che in T19 apre subito "Aggiungi da URL"; FLOW A.1); redirect a `/inbox` quando completo. `SyncDialog` (= `JobPreviewDialog` alimentato da `GET /api/sync/preview`, opzioni `force`/`postsOnly`) nasce qui perché lo usano onboarding, Impostazioni (T14) e Inbox vuota (T15). `lib/jobs.ts`: `useCurrentJob()` (polling 2,5 s se `running`), `useJobPreview(kind, params)`. `JobBanner` in sidebar: kind, durata, esito → toast con `result.summary` (+ `warnings` come toast neutro); stato `failed` → messaggio attribuito + bottone **Riprova** (`POST /api/jobs/:id/retry`). `JobPreviewDialog` generico (Radix `ui/dialog`): titolo, conteggi, `est_cost_usd` o "stima non disponibile", `warnings` in giallo, `blockers` in rosso con **Avvia disabilitato**. `ListPicker`: liste raggruppate per ICP + "Crea nuova lista" inline (nome + ICP). `StatusBadge` per i 9 stati (label italiane).
- **validation**: `npm --prefix web run typecheck && build` verdi; a DB vuoto (server reale su DB temporaneo, senza job) la home mostra i 3 passi con il primo attivo; `JobPreviewDialog` renderizzato con `blockers` non vuoti ha "Avvia" `disabled`. (Il percorso `failed` + Riprova del banner si valida in T14 contro T20, che qui non è ancora disponibile.)
- **status**: Done
- **log**:
  - 2026-09-16 (W4, worker): `web/src/api/types.ts` sui payload reali T4–T12 (settings/readiness, Icp, Company, `ProspectList`, `ProspectRow` con `analysis_state`/`analysis_error`, `ProspectDetail`, `Activity`, `Analysis`/`ProspectAnalyses`, `Job`/`JobPreview`/`JobResult`, `Post`, export) + enum runtime con label (`PROSPECT_STATUSES`, `STATUS_LABELS`, `REFERENCE_OUTCOME_LABELS`, `SOURCE_KIND_LABELS`, `CHANNEL_LABELS`, `DIRECTION_LABELS`, `FIT_FILTERS`, `JOB_KINDS`, `EMPLOYEES_MODES`) e `ApiErrorBody`. `client.ts`: `ApiError(status, message, body?)` retrocompatibile + `.code`/`.body`, `isApiError(err, code?)`, `qs` con booleani/array (CSV); oggetto `api` per risorsa (`settings`, `icps`, `companies` incl. `fromUrl/sourcePreview/startSourcing`, `lists`, `prospects` incl. `inboxIds/searchIds/bulkStatus/addTouchpoint/addNote/deleteActivity`, `jobs`, `sync`, `enrich`, `analyze` incl. `one/ofProspect`, `exports` incl. `preview/csvUrl`) + `queryKeys`. `lib/jobs.ts`: `useCurrentJob()` (polling 2,5 s anche in background), `useJobPreview(kind, params, {enabled})` (mai da cache), `useJobStart(start, {onStarted})` (202 → cache del banner; 409 `job_running`/400 `blocked` → toast col testo server + refetch preview), `useRetryJob()`, `JOB_KIND_LABELS`, `formatCost` ("stima non disponibile"), `formatDuration`, `describeJobError` (prefissi `actor:/config:/process:`), `jobOutcomeTone`, `isZeroOutcome`, `jobOutcomeLink`.
  - Componenti: `JobPreviewDialog {open, onOpenChange, title, description?, preview, countLabels?, summary?, children?, secondaryActions?, startLabel?, onStart, starting?}` (Avvia disabilitato con loading/errore/`blockers`; blockers rossi `role=alert` + `aria-describedby`, warnings gialli; focus restituito all'apertura); `SyncDialog {open, onOpenChange, onStarted?}` (`force`, "Aggiorna solo l'elenco dei post" con costo); `ListPicker {value, onChange(id, list), onCreated?, preferredIcpId?, label?, disabled?}` (radio per ICP, "Crea nuova lista" inline, preselezione se l'ICP ha una sola lista); `StatusBadge {status, className?}`; `JobBanner` (in sidebar: in corso con durata live o esito non letto; un toast persistente per esito, non ripetuto dopo reload via localStorage con try/catch; `failed` → errore attribuito + **Riprova**; a fine job invalida tutta la cache); `ui/toaster.tsx` → `toast({id?, tone: success|neutral|warning|error, title, description?, action?, persistent?})`, `dismissToast(id)`. Nav Inbox · Liste · ICP · Aziende · Impostazioni; `index.tsx` onboarding 3 passi (copy FLOW A.1, bottoni disabilitati con motivo visibile, alternativa "Aggiungi un'azienda e cerca le persone" → `/companies?add=1`), redirect a `/inbox` con profilo + ICP + almeno un prospect. `web/vite.config.ts`: proxy `/api` → `process.env.API_URL ?? 'http://localhost:8787'`.
  - Validazione (agent-browser, API su DB temporaneo porta 8801, Vite 5181): RED snapshot di `/` senza "Salva il tuo profilo LinkedIn" → GREEN "PASSO 1 · DA FARE / 1. Salva il tuo profilo LinkedIn e descrivi la tua azienda", link a `/settings`, `aria-current` sul passo 1, console pulita; SyncDialog con token assente → alert "APIFY_TOKEN mancante…" e "Avvia sync" + posts-only `[disabled]`, Esc riporta il focus. Extra: banner `failed` → Riprova → nuovo job `failed` `config:` (nessuna rete), toast non ripetuto al reload; esito con warnings ambra; `ListPicker` montato temporaneamente. `npm --prefix web run typecheck && build` verdi; vitest 25 file / 237 test; typecheck root rosso solo in `tests/e2e-deps.test.ts` di T20 in corso. Screenshot in scratchpad (`t13-*.png`); revisione orchestratore: onboarding e dialog conformi al FLOW.
  - Deviazioni/gotcha: nuovo toaster a 4 toni (il vecchio `pushToast` resta montato: le pagine nuove usano `toast`, i due stack si sovrapporrebbero). Link verso route non ancora esistenti tipizzati `as never`; `/companies?add=1` arriva come numero `1` (T19). Redirect della home solo con profilo + ICP + prospect (FLOW entry point diceva profilo + ICP). Radix senza `DialogTrigger` manda il focus a `body`: `JobPreviewDialog` lo ripristina. In agent-browser `visibilityState=hidden`: le animazioni di chiusura dei dialog finiscono solo dopo uno screenshot. Piccola ridondanza nel SyncDialog (due righe "stima non disponibile"). Titolo `web/index.html` "Lead Engine" corretto dall'orchestratore.
- **files edited/created**:
  - created: `web/src/lib/jobs.ts`, `web/src/components/{JobBanner,JobPreviewDialog,SyncDialog,ListPicker,StatusBadge}.tsx`, `web/src/components/ui/toaster.tsx`
  - edited: `web/src/api/client.ts`, `web/src/api/types.ts`, `web/src/routes/__root.tsx`, `web/src/routes/index.tsx`, `web/vite.config.ts`, `web/index.html` (orchestratore: titolo)
- **backlog_item_id**: CRM-S4
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s4
- **relation_mode**: body-links
- **tdd_target**: agent-browser: apri `/` a DB vuoto → snapshot contiene "Salva il tuo profilo LinkedIn" come passo 1 e il link porta a `/settings`.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T14: FE Impostazioni (profilo, azienda, post + sync, ultimi job) e ICP (con aziende di riferimento)

- **depends_on**: [T13, T4, T8, T20]
- **location**: `web/src/routes/settings.tsx`, `web/src/routes/icps.index.tsx`, `web/src/routes/icps.$id.tsx`
- **description**: **Impostazioni**: form profilo (URL LinkedIn; errore inline dal 400 server), azienda (nome, descrizione, offerta); sezione "I miei post" (`GET /api/posts`: data, excerpt, reazioni/commenti, ultimo sync); **Sincronizza interazioni** → `SyncDialog` (di T13; `postsOnly` proposto al primo sync); disabilitato con hint se `readiness.profile` è false; sezione "Ultimi job" (`GET /api/jobs?limit=20`: kind, stato, durata, summary/errore, Riprova sui `failed`). **ICP**: lista + dettaglio con form (nome, descrizione, ruoli target come chip, settori, località, dimensione, pains, note) e "Aziende di riferimento" (aggiungi da URL → `POST /api/companies/from-url` + riferimento con esito; rimuovi); elenco liste dell'ICP con link.
- **validation**: agent-browser (server T20): URL non-LinkedIn → errore inline; URL valido → Sync abilitato → dialog mostra preview → Avvia → banner → toast con summary; sync a 0 (fixture `EMPTY`) → toast neutro, nessun rosso; fixture `FAIL` → banner `failed` con errore `actor:` e **Riprova** che crea un nuovo job; crea ICP con 2 ruoli → chip; aggiungi azienda da URL → compare tra i riferimenti con esito.
- **status**: Done
- **log**:
  - 2026-09-16 (W5, worker): `/settings` → **Profilo LinkedIn** (form `#profilo` con focus da deep-link, 400 inline con `aria-invalid`/`aria-describedby`/`role=alert`, toast "Profilo salvato", URL normalizzato mostrato, preview di sync invalidate); **La mia azienda** (nome, descrizione, offerta, nota "Descrizione azienda vuota…"); **I miei post** (data, excerpt, reazioni/commenti dichiarati e letti, prospect generati, ultimo sync relativo, stato testuale; righe in errore con messaggio attribuito e "il prossimo sync lo riprende"; "sync in corso…" durante il job) con **Sincronizza interazioni** → `SyncDialog` (disabilitato con hint "Salva prima il tuo profilo LinkedIn."); **Ultimi job** (`GET /api/jobs?limit=20`: tipo, #id, opzioni, badge testuale In corso/Completato/Nessun risultato/Attenzione/Errore, avvio, durata, summary + warnings o errore attribuito; **Riprova** sui `failed`, disabilitato con hint a job in corso; refetch al cambio del job corrente). `/icps` → tabella (nome + descrizione, chip ruoli, n. liste, n. riferimenti, aggiornato), empty state, "Nuovo ICP". `/icps/$id` (anche `/icps/nuovo` per la creazione) → form completo con chip (Enter/virgola aggiungono senza submit; testo non confermato salvato), redirect al dettaglio dopo create; **Aziende di riferimento** (aggiungi da URL con esito + nota: `from-url` poi PUT; errore 400 inline; cambio esito, modifica nota, rimuovi; empty state FLOW); **Liste** con link `/lists/$id` e badge "Archiviata"; **Elimina ICP** disabilitato col testo server `icp_has_lists` (nessun consiglio "archivia prima"), conferma inline altrimenti, 409 in race → toast warning + refetch; id mancante → "ICP non trovato".
  - Validazione (agent-browser, e2e :8811, Vite :5191, screenshot `t14-*.png`, reset tra scenari): RED `/settings` "Pagina inesistente." → tdd_target: profilo vuoto → "Sincronizza interazioni" `[disabled]` + hint; URL non LinkedIn → alert inline, server `own_profile_url:null`; salvataggio `…/in/omar-test/` → abilitato, dialog senza blockers (warning primo sync + posts-only ≈ $0,05) → Avvia → banner "In corso: Sync interazioni" → toast "Sync completato: 2 post sincronizzati · 6 reazioni e 3 commenti letti · 7 nuovi prospect in Inbox · 1 senza profilo pubblico (saltati)." con "Apri Inbox"; `omar-empty` → toast neutro, nessun rosso in pagina; `omar-fail` → banner rosso con errore `actor:` + Riprova (job #2 con params identici) e Riprova da "Ultimi job" (job #3); ICP con 2 ruoli → chip nel dettaglio e nell'indice; azienda da URL (`/in/` rifiutato inline, `company/acme-robotica` con esito Vinta + nota → cambio esito, nota, rimozione, ri-aggiunta "già presente"); extra: delete disabilitato, race 409, `/icps/999`, riga post `partial` in errore. Web typecheck + build ok, root typecheck ok, vitest 25 file / 238 test. Revisione orchestratore dello screenshot del fallimento: conforme.
  - Deviazioni/gotcha: creazione ICP su `/icps/nuovo` (stessa route del dettaglio: niente form duplicato né export da file di route). "Riprova" in "Ultimi job" chiude il toast dell'esito con `dismissToast('job-outcome-<id>')` (dipende dalla convenzione di id di `JobBanner`). Esito di default "Vinta" nel form (server: `riferimento`). Vite dev non genera le classi Tailwind dei file creati dopo l'avvio (riavviare). I toast persistenti in basso a destra (384 px) possono coprire controlli allineati a destra (posizionamento di T13, non modificato). Nessun "Riprova questo post" (OQ-7 aperta).
- **files edited/created**:
  - created: `web/src/routes/settings.tsx`, `web/src/routes/icps.index.tsx`, `web/src/routes/icps.$id.tsx`
- **backlog_item_id**: CRM-S1
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s1
- **relation_mode**: body-links
- **tdd_target**: agent-browser: `/settings` con profilo vuoto → "Sincronizza interazioni" `disabled` con hint; dopo il salvataggio di `https://www.linkedin.com/in/omar-test/` → abilitato e il dialog mostra i `blockers` vuoti.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T15: FE Inbox, Liste e dettaglio Lista (filtri URL, bulk, enrich/analyze/export con preview)

- **depends_on**: [T13, T5, T10, T11, T12, T20]
- **location**: `web/src/routes/inbox.tsx`, `web/src/routes/lists.index.tsx`, `web/src/routes/lists.$id.tsx`, `web/src/components/{ProspectTable,BulkBar,AddToListDialog,ExportDialog,IcpPickerDialog}.tsx`
- **description**: `ProspectTable` condivisa (checkbox multi-select, "seleziona visibili", "seleziona tutti i filtrati" via `/ids`, colonne: nome/headline, azienda, stato, ✉ con testo alternativo, fit, fonti con tooltip, ultimo touchpoint) + `FilterBar`/`FilterChips` esistenti con **filtri nell'URL** (`validateSearch` hand-rolled). **Inbox**: tabella + `BulkBar` (Aggiungi a lista → `AddToListDialog` con `ListPicker`; Scarta; Analizza → `IcpPickerDialog` se >1 ICP, auto se 1, poi `JobPreviewDialog`); toggle "Mostra scartati" + bulk "Ripristina"; empty state "Nessuna interazione ancora" con bottone "Sincronizza ora" (riusa `SyncDialog`). **Liste**: card per ICP con conteggi per stato, "Nuova lista", archivia. **Lista**: header (ICP, descrizione, conteggi per stato cliccabili → filtro), tabella, `BulkBar` (cambia stato, rimuovi, arricchisci, analizza, esporta) — enrich/analyze passano da `JobPreviewDialog`; `ExportDialog` (filtri correnti o selezione, `hasEmail` default **on**, `markContacted` default **off**) → download + toast "N esportati"; nell'header della Lista l'azione **"Aggiungi persone da un'azienda"** è sempre presente (link `/companies?listId=<id>`, pagina di T19: nessun componente di T19 importato qui; FLOW D.1 riformulato come navigazione); empty state "Aggiungi dall'Inbox" (link `/inbox`) / "Estrai da un'azienda" (stesso link). Inbox: filtri URL `q, source, post, fit, icp, status(scartati), sort, page` sui parametri di `listInbox` (T5); il selettore `icp` compare solo con più di un ICP e il filtro `fit` è disabilitato finché non è scelto; "Arricchisci" nel `BulkBar` offre `retryFailed`.
- **validation**: agent-browser (server T20): Inbox con 3 prospect → seleziona 2 → Aggiungi a lista (crea lista inline) → Inbox 1 riga, lista 2; filtro stato nell'URL sopravvive al reload; preview analisi "2 da arricchire · 2 da analizzare · ~$0,06"; export scarica CSV e toast "2 esportati"; Scarta → Mostra scartati → Ripristina.
- **status**: Done
- **log**:
  - 2026-09-16 (W5, worker): `ProspectTable` condivisa (selezione per id controllata dalla pagina e persistente tra filtri/pagine; checkbox header "Seleziona tutti i visibili (N)" con stato misto; "Seleziona tutti i N filtrati" via `/ids` con cap 500 e avviso FLOW; colonne attivabili `sources|company|status|email|fit|lists|lastTouchpoint|capturedAt`; tooltip fit/fonti anche da tastiera; stato/✉/fit sempre con testo; paginazione opzionale; `aria-busy`) + helper URL (`searchParam.text/id/page/oneOf/csv/bool`, `csvValues`, `useSearchDraft` 300 ms) e testi (`FIT_FILTER_LABELS`, `ANALYSIS_STATE_LABELS`, `REFUSAL_TEXT`, `describeSource`, `formatDay`, `timeAgo`). `BulkBar.tsx` → `BulkBar` (sticky, contatore live region), `EnrichDialog` (`retryFailed`, selezione o lista), `useDialogFocusReturn`, `BulkJobScope`. `IcpPickerDialog.tsx` → `IcpPickerDialog` (radio senza default; zero ICP → "Crea prima un ICP…") + `AnalyzeDialog` (salta il picker con ICP unico o fissato dalla lista; preview conteggi/costo/modello; `force`). `AddToListDialog` (`ListPicker` con creazione inline; toast "N aggiunti a 'X' · M già presenti · lista creata" + "Apri lista"). `ExportDialog` (`hasEmail` on, `markContacted` off, conteggio live da `/exports/preview`, disabilitato a 0 con motivo, download `download_url`, toast "N esportati · CSV scaricato"). **Inbox**: filtri URL `q, source, post, fit, icp, status, sort, page` (selettore ICP solo con >1 ICP, `fit` disabilitato finché non scelto; parametri invalidi scartati); BulkBar Aggiungi a lista / Scarta / Analizza… / Arricchisci…; "Mostra scartati" → `status=scartato` + Ripristina; empty state (nessuna interazione con Sincronizza ora, Inbox pulita, nessuno scartato, nessun risultato + Pulisci). **Liste**: gruppi per ICP con conteggi per stato, "Nuova lista", archivia/ripristina, "Mostra archiviate" nell'URL. **Lista**: chip di stato (`aria-pressed`) che filtrano, contatori arricchiti/analizzati/con email, "Aggiungi persone da un'azienda" → `/companies?listId=<id>`, "Sulla lista" Arricchisci/Analizza/Esporta (con filtri attivi usa gli id filtrati, cap 500), BulkBar Cambia stato / Rimuovi / Arricchisci / Analizza / Esporta, "Export precedenti" con Scarica di nuovo, empty state, banner archiviata (job disabilitati, export ammesso), "Lista non trovata".
  - Validazione (agent-browser, e2e :8812, Vite :5192, screenshot `t15-*.png`): RED `/inbox` "Pagina inesistente" → tdd_target: seed 5 in Inbox, selezione Giulia + Paolo → Aggiungi a lista → crea "Triage T15" → toast → Inbox 3 righe, `/lists/2` 2 righe; filtro stato in URL sopravvive al reload (lista e Inbox, anche `page=2`); preview analisi "2 selezionati · 2 da arricchire prima · 2 da analizzare · ≈ $0,06 · claude-opus-5" + warning prezzo profilo; stati di riga errore/non arricchibile/rifiutata (tooltip testo FLOW) e alto/basso; filtro `fit` con i nuovi valori, anche con 2 ICP e "riprova solo i falliti" senza `force`; export: CSV scaricato (header + 2 righe), toast "2 esportati · CSV scaricato", storico; lista senza email → disabilitato con motivo; `markContacted` → chip "Contattato 2"; Scarta → Mostra scartati → Ripristina; 815 righe → "Selezionati i primi 500 di 815"; lista archiviata; enrich `retryFailed`; picker ICP a zero/2 ICP con focus restituito. Web typecheck + build ok, root typecheck ok, vitest 25 file / 238 test. Revisione orchestratore (Inbox con stati di analisi, Lista dopo export): conforme; Giulia Marchetti mostra reazione + commento su un solo prospect (fix identità visibile).
  - Deviazioni/gotcha: `EnrichDialog`/`useDialogFocusReturn` in `BulkBar.tsx` e `AnalyzeDialog` in `IcpPickerDialog.tsx` (nessun file dedicato nella location). Azioni "Sulla lista" con filtri attivi usano gli id filtrati (gli endpoint di lista non accettano filtri). Corretto un bug di layout (descrizione `truncate` allargava il picker e tagliava "Continua"). Vite dev non genera le classi Tailwind dei file nuovi (riavviare). Etichette leggermente diverse dal FLOW ("Seleziona tutti i visibili (N)", "tentati di recente senza risultato"). Rischi: dopo Aggiungi a lista/Scarta il focus cade su `body`; "Avvia" di enrich/analyze resta abilitato con 0 target (nessun blocker server). Per T19: props `ProspectTable {rows, caption, selected, onSelectedChange, columns?, fitWithIcp?, listId?, selectAll?, pagination?, busy?}`, suggerito `columns={{lists: true, capturedAt: false}}` + `api.prospects.searchIds({companyId})`.
- **files edited/created**:
  - created: `web/src/routes/inbox.tsx`, `web/src/routes/lists.index.tsx`, `web/src/routes/lists.$id.tsx`, `web/src/components/{ProspectTable,BulkBar,AddToListDialog,ExportDialog,IcpPickerDialog}.tsx`
- **backlog_item_id**: CRM-S4
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s4
- **relation_mode**: body-links
- **tdd_target**: agent-browser: `/inbox` con 3 prospect → seleziona 2 → "Aggiungi a lista" → "Crea nuova lista" (nome, ICP) → snapshot Inbox ha 1 riga e `/lists/<nuova>` ne ha 2.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T16: FE dettaglio Prospect (stato, timeline, touchpoint, analisi, fonti)

- **depends_on**: [T13, T5, T10, T11, T20]
- **location**: `web/src/routes/prospects.$id.tsx`, `web/src/components/{Timeline,TouchpointForm,AnalysisCard,StatusSelect}.tsx`
- **description**: Header: nome, headline, azienda/ruolo, link LinkedIn, `StatusSelect` (cambio stato con nota opzionale), badge delle liste di appartenenza (stato globale: un solo badge stato). Colonna sinistra: anagrafica editabile, **Fonti** (tipo, post/azienda, reaction type, testo commento), About/esperienze da `raw_json`. Colonna destra: `AnalysisCard` per l'ICP corrente (selettore ICP se in più liste o in Inbox), dati da `GET /api/prospects/:id/analyses?icpId=` (T11): riassunto, 3 angoli con rationale, fit badge, badge "da aggiornare" se `stale`; bottone "Analizza"/"Rianalizza"; se non arricchito → "Arricchisci e analizza" (`enrichFirst:true`, sincrono, `aria-busy`, "Sto analizzando…"); errori (refusal, non arricchibile) come `ErrorBox` con testo del server. **Timeline** (attività desc, icone per kind, canale/direzione, testo espandibile, elimina su touchpoint/note). `TouchpointForm` (canale, direzione, data/ora default now, lista di contesto, testo facoltativo, nota, "nuovo stato" opzionale). Copia negli appunti per angoli e riassunto.
- **validation**: agent-browser (server T20): touchpoint `linkedin_dm` outbound con "nuovo stato: contattato" → timeline 2 voci e badge stato cambia; analisi salvata → 3 angoli; non arricchito → "Arricchisci e analizza" → card popolata; fixture refusal → `ErrorBox` e nessun angolo; prospect in 2 liste → 2 badge lista, 1 stato.
- **status**: Done
- **log**:
  - 2026-09-16 (W5, worker): route `/prospects/$id?list=` (lista di contesto e ICP di default; id inesistente/malformato o prospect sparito dopo un merge → vista "Prospect non trovato" con link a Inbox/Liste). Header: nome, headline, ruolo · azienda (link se `company_id`), località, "Apri su LinkedIn", `StatusSelect` (badge + "Cambia stato…" con nota e conferma inline), badge liste o "In Inbox", "Aggiungi a lista" (dialog locale con `ListPicker`), nota "stato condiviso" con 2+ liste. Colonna sinistra: anagrafica editabile (PATCH solo campi cambiati, errori 400 per campo), Fonti (reazione con label, commento con testo, dipendente di azienda), profilo LinkedIn letto tollerante da `raw` (About espandibile/modificabile, esperienze, formazione, certificazioni, skill), stato arricchimento + "Arricchisci" (JobPreviewDialog → `POST /api/prospects/:id/enrich`). `AnalysisCard`: selettore ICP se >1, fit testuale, badge "da aggiornare" (`stale`), riassunto + 3 angoli con Copia, un'azione (Analizza / Rianalizza `force` / Riprova / Arricchisci e analizza `enrichFirst`), `aria-busy` + testo d'attesa FLOW (stato via `useIsMutating`, sopravvive alla navigazione), errori server in `ErrorBox`. `Timeline`: `<ol>` semantica, icona per kind, canale/direzione, chip lista, `<time>`, testo espandibile, elimina solo touchpoint/note con conferma inline. `TouchpointForm`: canale (default DM LinkedIn), direzione, data/ora, lista di contesto (obbligatoria con 2+ liste senza `?list`), testo, nota, nuovo stato con suggerimento "Usa" mai automatico. `StatusSelect.tsx` esporta `invalidateProspectViews(queryClient)`.
  - Validazione (agent-browser, e2e :8813, Vite :5193, screenshot `t16-*.png`): RED `/prospects/6` "Pagina inesistente." → tdd_target: DM LinkedIn "Ciao Anna…" + Contattato → header "Contattato", timeline `Touchpoint · DM LinkedIn · in uscita` sopra `Stato: Nuovo → Contattato`; elimina touchpoint → stato invariato, `status_change` senza elimina; cambio stato con nota; 2 liste → 2 badge, 1 stato, lista di contesto obbligatoria con `aria-invalid`; Marco non arricchito → "Arricchisci e analizza" (`Sto analizzando…` disabled) → fit medio, 3 angoli, About/esperienze, timeline Analisi + Arricchimento; Giulia analisi salvata → 3 angoli; About modificato → "da aggiornare" (`stale:true`); Sara refusal → alert col testo FLOW, nessun angolo, persiste al reload; Davide JSON invalido; Chiara senza dati → About a mano → analisi ok; `/prospects/999` e `/abc` → non trovato; extra: aggiungi a lista, job di arricchimento con preview e banner, cambio ICP. `npm --prefix web run typecheck && build` ok, root typecheck ok, vitest 238/238 (una run su 5 con 1 fallimento non catturato, sotto carico). Revisione orchestratore dello screenshot finale: conforme (la sidebar corta negli screenshot full-page è un artefatto di `fixed inset-y-0`).
  - Deviazioni/gotcha: Vite non genera le classi Tailwind di una route creata dopo l'avvio (riavviare Vite; la build è corretta). In agent-browser con finestra bassa serve `scrollintoview` prima di cliccare sotto la piega. Elimina attività con conferma (irreversibile, FLOW esenta solo le azioni reversibili). Extra: "Aggiungi a lista" nell'header, "Arricchisci" singolo con preview, "Scrivi/Modifica About" (recupero FLOW). Nessun form "nota" separato; niente storico analisi per ICP (solo l'ultima).
- **files edited/created**:
  - created: `web/src/routes/prospects.$id.tsx`, `web/src/components/{Timeline,TouchpointForm,AnalysisCard,StatusSelect}.tsx`
- **backlog_item_id**: CRM-S5
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s5
- **relation_mode**: body-links
- **tdd_target**: agent-browser: su `/prospects/:id` compila `TouchpointForm` (canale LinkedIn DM, testo "Ciao Anna…", nuovo stato "contattato") → submit → prima voce della timeline contiene "Ciao Anna" e lo stato in header è "Contattato".
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T17: README, AGENTS gates, `.env.example`, script npm, Constitution

- **depends_on**: [T14, T15, T16, T19]
- **location**: `README.md`, `AGENTS.md`, `.env.example`, `package.json`, `brain/specs/CONSTITUTION.md`
- **description**: README riscritto per il CRM (cosa fa, setup, `npm run ui`, flusso consigliato, actor usati e costi, note ToS/GDPR, variabili). `AGENTS.md` root: **Project guidelines** con i gate (`npm run typecheck`, `npm test`, `npm --prefix web run typecheck`, `npm --prefix web run build`), convenzioni test (server vitest / FE agent-browser contro `npm run e2e:server`), regola "input actor solo in `src/apify/actors.ts`", regola anti co-edit (route/handler per file). `CONSTITUTION.md`: TODO sostituiti con gli stessi gate. `.env.example`: solo variabili vive (T3). `package.json`: `description`, script `ui/api/ui:build/test/typecheck/db:init/e2e:server`.
- **validation**: `grep -riE 'lead engine|daily_selection|bucket|selezione' README.md AGENTS.md .env.example` vuoto; `npm run` elenca solo script esistenti.
- **status**: Done
- **log**:
  - 2026-09-16 (W7, worker): `README.md` riscritto in italiano per l'utente singolo (cosa fa il CRM; setup `pnpm install` + `npm --prefix web install` + `.env` + `npm run ui` su :8787/:5173, `db:init` opzionale; flusso consigliato in 8 passi; 9 stati; job con preview; colonne CSV; tabella actor/costi con start fee harvestapi $0,02 (Short 50 ≈ $0,22), profile-detail senza stima finché `PRICE_PROFILE_DETAIL_USD` è vuoto, `claude-opus-5` ≈ $0,03 a prospect con `max_tokens` 16 000; note ToS/GDPR/dati; 16 variabili; server e2e fake; struttura del codice). `AGENTS.md` (`CLAUDE.md` è un symlink) → **Project guidelines**: 4 gate (web build prima del web typecheck), test (vitest con DB temporaneo per processo e import dinamici; FE con agent-browser contro `npm run e2e:server` + Vite `API_URL`; mai Apify/Claude reali; stop dei server **per PID**, mai `pkill -f`), regole di architettura (input actor solo in `src/apify/actors.ts`; un router e un job kind per file, `app.ts`/`handlers.ts` solo cablaggio; identità prospect con `upsertProspect`/`setProspectIdentity`/`mergeProspects`/`memberUrn`; derivati mai colonne; stati sempre manuali), convenzioni API (`{error, code?}`, `{items}`, 400 `blocked` vs 409 `job_running`, prefissi `actor:/config:/process:`), regole FE e nota pnpm 10 / npm. `.env.example`: solo le 16 variabili lette (`config.ts` + `DB_PATH`, `UI_PORT`), token attivi e opzionali commentati. `package.json`: descrizione nuova, script `ui, api, ui:build, db:init, cli, e2e:server, test, test:watch, typecheck` (rimosso `build` verso `dist/` inutilizzato). `CONSTITUTION.md`: TODO sostituiti con gate, regole di test, confini di ownership, contratti e review gate. Extra autorizzati: `.gitignore` + `web/.tanstack/`; `tsconfig.tests.json` + `scripts/**/*.ts` (ora `npm run typecheck` copre `scripts/e2e-server.ts`, nessuna modifica di codice necessaria).
  - Validazione (non testabile, verifiche meccaniche): `grep -riE 'lead engine|daily_selection|bucket|selezione' README.md AGENTS.md CLAUDE.md .env.example` vuoto (ripetuto dall'orchestratore: exit 1); `npm run` = 9 script, ciascuno verificato (`db:init` su `DB_PATH` temporaneo → 13 tabelle; `cli --help`; `api` su 8841 `/api/health` ok; `e2e:server` su 8842 + seed ok; `ui`/`ui:build`/`test:watch` verificati sui target); `npm run typecheck` exit 0 con `scripts/` incluso; vitest 25 file / 238 test; variabili di `.env.example` = variabili lette dal codice; link relativi del README esistenti.
  - Incidente: `pkill -f "scripts/e2e-server.ts"` durante la pulizia ha probabilmente fermato il server e2e di T18 (porta 8831) per ~3 minuti; T18 avvisato dall'orchestratore di rieseguire i passi a cavallo. Regola "stop per PID" aggiunta in `AGENTS.md`. Nota: `data/sevedemo.db` legacy citato solo come "mai letto".
- **files edited/created**:
  - edited: `README.md`, `AGENTS.md` (via symlink anche `CLAUDE.md`), `.env.example`, `package.json`, `brain/specs/CONSTITUTION.md`, `.gitignore`, `tsconfig.tests.json`
- **backlog_item_id**: CRM-S0
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s0
- **relation_mode**: body-links
- **tdd_target**: n/a (documentazione) — verifica meccanica `grep` come in validation.
- **review_mode**: cli

### T18: Smoke end-to-end (agent-browser): percorso completo + percorsi non felici

- **depends_on**: [T14, T15, T16, T19, T20]
- **location**: `tests/e2e/smoke.md` (scenario documentato), `brain/tech-debt/prospect-crm/crm-foundation.md` (attriti)
- **description**: Contro `npm run e2e:server` (T20) a DB vuoto: onboarding → profilo e azienda → ICP con ruoli → sync (fixture) → Inbox → bulk aggiungi 2 a lista nuova → azienda da URL come riferimento → sourcing (fixture) nella lista → preview + analisi bulk (fake) → dettaglio prospect: angoli, touchpoint con cambio stato → export CSV `hasEmail` → colonne. **Percorsi non felici** (FLOW): job `failed` (fixture `FAIL`) + Riprova; sync a 0 (esito neutro); refusal su un'analisi; prospect in 2 liste con stato globale; Inbox con 2 ICP → `IcpPickerDialog`; descrizione azienda vuota → warning in preview. Ogni passo con snapshot e asserzioni testuali; attriti registrati come tech-debt.
- **validation**: scenario completato; console `agent-browser` senza `error`; CSV con header atteso.
- **status**: Done
- **log**:
  - 2026-09-16 (W7, worker): `tests/e2e/smoke.md` = scenario ripetibile (setup e comandi, 27 passi del percorso completo e 14 percorsi non felici, ciascuno con azione + asserzione testuale + evidenza, gotcha di automazione). `brain/tech-debt/prospect-crm/crm-foundation.md` = 22 voci MINOR (TD-1…TD-9 note, TD-10…TD-22 nuove) con stato, tipo, severità, evidenza e chiusura; collegato da `brain/index.md` dall'orchestratore.
  - Percorso completo a DB vuoto (UI da `web/dist` servita dal server e2e su 8831), tutto PASS: onboarding con passo 1 attivo e passo 3 disabilitato con motivi; URL profilo invalido → alert inline; profilo + azienda; ICP con 2 chip; home con passi 1–2 FATTO; primo sync → stima non disponibile + posts-only (≈ $0,05) → "Elenco post aggiornato: 2 post letti" → stima reale ≈ $0,10 → banner → toast esito + redirect a `/inbox`; **tdd_target**: Inbox 7 righe con `aria-label="reazione"`, Giulia una sola riga con reazione + commento; selezione 2 → lista creata inline → Inbox 5, lista 2; azienda da URL come riferimento "Vinta"; sourcing con ruoli/località dall'ICP (≈ $0,22) → "3 persone lette · 3 aggiunte (2 nuove, 1 già in archivio)", Giulia con 3 fonti; preview analisi "5 da arricchire prima · 5 da analizzare · ≈ $0,15 · claude-opus-5" → 5 analizzati; dettaglio Giulia fit alto + 3 angoli; touchpoint DM → "Contattato" + timeline; export "2 prospect (3 senza email esclusi)" → "2 esportati · CSV scaricato", storico, attività; CSV `header_ok True rows 2` identico a `GET /api/exports/1.csv`.
  - Percorsi non felici, tutti PASS: sync a zero neutro; profilo `omar-fail` → banner rosso + Riprova (job con params identici); `FAIL_ONCE` → Riprova riesce; prospect in 2 liste → 2 badge, 1 stato; Inbox con 2 ICP → `IcpPickerDialog` senza default; stati di riga errore/non arricchibile/rifiutata con tooltip FLOW; descrizione azienda vuota → warning in preview; refusal singolo → alert FLOW senza angoli; Scarta/Mostra scartati/Ripristina; `PARTIAL` → post in errore; sourcing `acme-empty` neutro; `E2E_NO_APIFY`/`E2E_NO_ANTHROPIC` → blocker con Avvia disabilitato; job lento → "C'è già un job in corso…" e analisi singola ok durante un bulk. Console `agent-browser` senza errori a fine di ogni sezione. Web typecheck, root typecheck, vitest 25 file / 238 test. Gate W7 (orchestratore): typecheck root + web exit 0, vitest 25 file / 238 test, build web ok, nessun processo residuo.
  - Voci note: confermate TD-2, 3, 4, 6, 7, 8, 9; non riprodotte TD-1 (fixture con nome e headline identici: il merge funziona) e TD-5 (solo dev). Nuove (MINOR): TD-10 il banner non scopre un job avviato fuori dalla pagina fino a reload/focus (e `tests/e2e/README.md` dice il contrario); TD-11 "Analisi completato"; TD-12 plurali ("1 letti"); TD-13 azienda da URL chiamata con lo slug; TD-14 "Arricchisci e analizza" abilitato senza token; TD-15 cambio profilo non separa i post; TD-16 stati di errore del fit senza ICP con più ICP; TD-17 Riprova sui falliti già ripresi; TD-18 "(fonte aggiunta)" spurio; TD-19 warning senza link "Compila"; TD-20 dialog aggiungi a lista del dettaglio (preselezione, label "Close"); TD-21 posts-only con badge "Nessun risultato"; TD-22 hint pains sempre visibile. Incidente: il `pkill -f` di T17 ha fermato il server dopo lo screenshot del passo 1 (sola lettura); dal passo 2 tutto sul server riavviato a DB vuoto, nessuna evidenza mista.
- **files edited/created**:
  - created: `tests/e2e/smoke.md`, `brain/tech-debt/prospect-crm/crm-foundation.md`
  - edited (orchestratore): `brain/index.md` (link al tech-debt)
- **backlog_item_id**: CRM-S2
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s2
- **relation_mode**: body-links
- **tdd_target**: agent-browser: a DB vuoto, dopo profilo→ICP→sync(fixture), `/inbox` mostra ≥ 1 riga con icona "reazione".
- **review_mode**: mixed
- **assigned_skills**: [agent-browser]

### T19: FE Aziende (anagrafica, riferimenti, prospect collegati) e `SourceCompanyDialog`

- **depends_on**: [T13, T4, T9, T20, T15]
- **location**: `web/src/routes/companies.index.tsx`, `web/src/routes/companies.$id.tsx`, `web/src/components/SourceCompanyDialog.tsx`
- **description**: **Aziende**: lista (nome, settore, riferimento di quali ICP, n. prospect) + "Aggiungi da URL" (`from-url`); search param `?listId=` (dalla Lista di T15) o `?add=1` (dall'onboarding di T13) apre subito "Aggiungi da URL"; `listId` pre-seleziona anche la lista nel dialog di sourcing; dettaglio: anagrafica editabile, riferimenti ICP con esito, prospect collegati (`ProspectTable` con filtro `companyId`), bottone **Estrai persone** → `SourceCompanyDialog`: `ListPicker` (con creazione inline), ruoli precompilati dall'ICP della lista (chip editabili), `maxItems`, modalità Short/Full/Full+email con prezzo, poi `JobPreviewDialog` (`warnings` se ICP senza ruoli) → Avvia. Empty state: "Nessuna azienda: aggiungi la prima da un URL LinkedIn".
- **validation**: agent-browser (server T20): aggiungi azienda da URL → dettaglio; Estrai persone → scegli lista → ruoli precompilati → preview con stima → Avvia → banner → la lista ha i membri della fixture; ICP senza ruoli → warning visibile.
- **status**: Done
- **log**:
  - 2026-09-16 (W6, worker): `/companies` → tabella (nome + URL + località, settore, chip "Riferimento per" `ICP · Esito` con link, n. prospect, aggiunta il), ricerca `q` nell'URL, empty state "Nessuna azienda: aggiungi la prima da un URL LinkedIn.", **Aggiungi da URL** (`from-url`: nuova → dettaglio + toast; esistente `created:false` → inline "Azienda già presente: apri <nome>" con link; 400 inline con `aria-invalid`); `?add=1` e `?listId=` aprono subito il form, `listId` mostra il banner "Aggiungi persone alla lista X" (nota se archiviata) e viaggia sui link. `/companies/$id` (`listId`, `page` validati) → **Anagrafica** editabile (PATCH dei soli campi cambiati; 409 `duplicate` inline con link; URL invalido inline); **Riferimento per ICP** (esito, rimuovi, "Segna come riferimento"); **Ricerche di persone** (FLOW D.4: job `source_company` dell'azienda con stato, lista, ruoli, max, modalità, summary o errore; zero/fallito → "Riprova con altri filtri" riapre il dialog coi params del job); **Prospect collegati** (`ProspectTable` con `companyId`, colonne liste, `fitWithIcp`, seleziona tutti via `searchIds({companyId})`, pagina nell'URL, `BulkBar` → `AddToListDialog`); **Estrai persone** (header + empty state; `?listId=` apre il dialog con la lista preselezionata e si rimuove dall'URL); "Azienda non trovata". `SourceCompanyDialog` ("Cerca persone in X" / "Avvia ricerca", su `JobPreviewDialog`): `ListPicker` con creazione inline + "ICP: <nome>"; chip ruoli e località precompilati dall'ICP (Enter/virgola, ×, "Usa i ruoli/le località dell'ICP"), inviati solo se modificati (così il server dà il warning specifico dell'ICP); "Massimo persone" dal default server con validazione 1–2500; modalità con prezzi da 3 preview, nota start fee e hint Short FLOW; Avvia disabilitato finché la preview non corrisponde al massimo digitato (debounce 300 ms) ed è stata ricaricata in questa apertura. Export helper: `companyLabel`, `shortCompanyUrl`, `CompanyExistsNotice`, `sourceValuesFromJob`, `SourceDialogValues`, `EMPLOYEES_MAX_ITEMS`.
  - Validazione (agent-browser `t19`, e2e :8821, Vite :5201, screenshot `t19-*.png`): RED `/companies/1` "Pagina inesistente" → tdd_target: lista L (ICP `['CTO']`) → chip "Rimuovi ruolo CTO", "Short … (≈ $0,22)", "Costo stimato: ≈ $0,22"; aggiungi da URL → dettaglio; Avvia → params `{companyId, listId, roles:['CTO'], locations:[], maxItems:50, mode:'Short'}` → banner → "…4 aggiunte a 'Lista L CTO startup'…" → lista con 4 membri `nuovo`, 4 prospect collegati, storico; ICP senza ruoli → warning ambra (aggiungendo un chip sparisce); prezzi max 100 → $0,42/$0,82/$1,22, max 3000 → errore e Avvia disabilitato; `?listId=` da lista vuota → form con focus → dettaglio col dialog aperto → Full → "arricchiti 4/4"; `?add=1` dall'onboarding; Full+email → email 3; duplicato inline in entrambi i form; lista archiviata e job in corso → blocker; `acme-empty` → toast neutro + "Riprova con altri filtri"; `acme-fail` → banner rosso + Riprova (nuovo job, params identici); prospect collegati → Aggiungi a lista; riferimenti; `/companies/999`. Web typecheck + build ok, root typecheck ok, vitest 25 file / 238 test, console pulita.
  - Deviazioni/gotcha: il duplicato in "Aggiungi da URL" arriva come `created:false` (il 409 solo in modifica anagrafica). "Riprova con altri filtri" sta nello storico del dettaglio (il toast del `JobBanner` non può riaprire il dialog). `useJobPreview` poteva mostrare per un attimo la preview dell'apertura precedente con Avvia abilitato: aggirato qui con `isFetchedAfterMount` e corretto dall'orchestratore per tutti i dialog in `JobPreviewDialog` (Avvia disabilitato durante il refetch). Con viewport 577 px `find … click` sotto la piega chiude il dialog: usare `scrollintoview` o viewport più alta. `?add=1` riscritto in `?add=true` dal router. Extra: ricerca aziende, modifica riferimenti, storico ricerche.
- **files edited/created**:
  - created: `web/src/routes/companies.index.tsx`, `web/src/routes/companies.$id.tsx`, `web/src/components/SourceCompanyDialog.tsx`
  - edited (orchestratore): `web/src/components/JobPreviewDialog.tsx` (Avvia disabilitato durante il refetch della preview)
- **backlog_item_id**: CRM-S3
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s3
- **relation_mode**: body-links
- **tdd_target**: agent-browser: su `/companies/:id`, "Estrai persone" → scegli lista L (ICP con ruoli `CTO`) → il dialog mostra il chip "CTO" e la preview `est_cost_usd` per Short a `maxItems` 50 ("~$0,22": $0,20 + start fee harvestapi $0,02, T9).
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T20: Server fake per validazione FE ed e2e (`E2E_FAKE_JOBS=1`)

- **depends_on**: [T6, T8, T9, T10, T11]
- **location**: `scripts/e2e-server.ts`, `src/jobs/fake-deps.ts` (stub di T3, riempito qui; `deps.ts` di T6 **non** si tocca), `tests/fixtures/e2e/{posts,reactions,comments,employees,profile-detail,analysis}.json`, `tests/e2e/README.md`, `tests/e2e-deps.test.ts`, `package.json` (script `e2e:server`)
- **description**: `npm run e2e:server` avvia l'API su DB scratch temporaneo: imposta `DB_PATH` in tmp (azzerato all'avvio), `E2E_FAKE_JOBS=1` e `APIFY_TOKEN`/`ANTHROPIC_API_KEY` fittizi **prima** di importare `config` (letta a import-time), così `readiness` li vede presenti senza toccare T4; **rifiuta di partire** se `DB_PATH` punta al default `data/crm.db` (protegge i dati reali da `/api/e2e/reset`). `fakeDeps(kind)` ritorna deps fixture-backed per i 4 kind (post/reazioni/commenti/dipendenti/profile-detail da `tests/fixtures/e2e/*`), `client` Claude fake che ritorna `analysis.json` (e `refusal` per un prospect marcato nella fixture), e comportamenti pilotabili dai `params`: `params.__fixture === 'EMPTY'` → 0 risultati, `'FAIL'` → handler lancia `actor:<id>: simulato`. Endpoint di supporto `POST /api/e2e/reset`, **registrato in `scripts/e2e-server.ts`** sull'istanza restituita da `createApp()` (T20 non tocca `app.ts`, regola §8). Documenta in `tests/e2e/README.md` come usarlo con `agent-browser`.
- **validation**: `curl POST /api/sync/interactions` in modalità fake → job `succeeded` con prospect in Inbox dalle fixture; `params.__fixture:'FAIL'` → `failed` con errore `actor:`; `POST /api/prospects/:id/analyze` → analisi dalla fixture; `/api/e2e/reset` → DB vuoto.
- **status**: Done
- **log**:
  - 2026-09-16 (W4, worker): `src/jobs/fake-deps.ts` → `fakeDeps(kind)` fixture-backed per i 4 kind con i layout reali degli actor (mapper, job e scritture DB girano davvero); `params.__fixture` letto dal job stesso (`findJob(Number(process.env.JOB_ID))`, solo se `job.kind === kind`), senza toccare file altrui; nel processo server (analisi sincrona) valgono solo i trigger nei dati. Client Claude fake: risposta per riga `Nome:` (fit alto/medio/basso, refusal, JSON invalido) o marcatori `e2e-…` nel testo del profilo; default = analisi generica. Profili sintetici per le persone fuori fixture. `scripts/e2e-server.ts` (`npm run e2e:server`): env prima degli import dinamici (`DB_PATH` default `$TMPDIR/crm-e2e-<port>/crm.db` azzerato all'avvio, `E2E_FAKE_JOBS=1`, token fittizi, `DOTENV_CONFIG_PATH=/dev/null`), rifiuta di partire con `DB_PATH` dentro `data/`, porta `UI_PORT` (default 8790), `POST /api/e2e/reset` e `POST /api/e2e/seed` registrati sull'istanza di `createApp()` (409 con job in corso), serve `web/dist` se presente. Extra: `E2E_FAKE_DELAY_MS` (default 1000), `E2E_NO_APIFY` / `E2E_NO_ANTHROPIC`.
  - Trigger (documentati in `tests/e2e/README.md`): `__fixture` (sync, `POST /api/analyze`, `POST /api/lists/:id/analyze`) = `EMPTY` | `FAIL` | `FAIL_ONCE` (Riprova riesce) | `WARN` (post con 12 reazioni dichiarate e 0 lette) | `PARTIAL` (commenti del post 2 in errore → `sync_state:error`). Parole nei dati: slug profilo utente (`fail`, `fail-once`, `empty`, `warn`, `partial`); slug azienda nel sourcing (`fail`, `empty`, `fail-once`); prospect da arricchire (`nodata` → non arricchibile / 409 `not_enrichable`, `enrich-error` → errore provider / 502 `enrich_failed`); testo al modello (`e2e-refusal` → 502 `refusal`, `e2e-invalid-json` → 502 `invalid_output`, `e2e-fit-alto|medio|basso`); le parole passano dall'azienda alle persone. Dati fissi: sync = 2 post, 6 reazioni, 3 commenti → 7 prospect (Giulia Marchetti: reazione id membro + commento slug = 1 prospect, fit alto; Luca Bernardi commento "Kubernetes" medio; Paolo Ranieri basso con email nell'About; Marco Ferri default; Sara Colombo refusal; Davide Greco JSON invalido; Chiara Lombardi nessun dato); sourcing = 4 persone + 1 nascosta, `company/ferronova-digitale-e2e` = Giulia (già nota) + Stefano Villa + Elena Rota; seed = profilo, azienda utente, 1 ICP con ruoli, azienda di riferimento vinta, 1 lista con Luca e Marco, 5 in Inbox (id tutti 1).
  - Validazione: RED `NotImplementedError … (T20)` → `e2e-deps` 18 test (reset, sourcing, enrich, analisi, seed; regressione `FAIL_ONCE` RED `expected 'succeeded' to be 'failed'` → fix confrontando i params; mutation su `FAIL_ONCE`/`PARTIAL` → 2 test rossi). Curl su porta 8802: sync fake in figlio reale `succeeded` (7 prospect, Giulia unica con 2 fonti; env del figlio con `E2E_FAKE_JOBS`, `DB_PATH`, `JOB_ID`); `FAIL` → `failed` `actor:apimaestro/linkedin-profile-posts: …`; analisi Giulia alto / Luca medio / Paolo basso con 3 angoli, Sara 502 refusal, Davide 502 invalid_output, Chiara 409; sourcing Short stima 0.22; reset → DB vuoto; `DB_PATH=data/crm.db` → exit 1. Gate W4 (orchestratore): typecheck 0 errori, 25 file / 238 test, web typecheck + build ok, nessun processo residuo.
  - Deviazioni/gotcha: il guard protegge tutto `data/` (anche il legacy `sevedemo.db`). Sourcing fake non filtra per ruolo. Post URL fuori fixture → item del primo post. Il seed sincronizza senza riga `jobs` ("Ultimi job" vuoto). `scripts/` fuori dagli `include` dei tsconfig: `npm run typecheck` non lo copre (T17). `web/dist` servito se presente ma può essere vecchio: usare Vite con `API_URL`.
- **files edited/created**:
  - created: `scripts/e2e-server.ts`, `tests/e2e-deps.test.ts`, `tests/e2e/README.md`, `tests/fixtures/e2e/{posts,reactions,comments,employees,profile-detail,analysis}.json`
  - edited: `src/jobs/fake-deps.ts` (stub T3), `package.json` (script `e2e:server`)
- **backlog_item_id**: CRM-S2
- **backlog_item_url**: brain/specs/prospect-crm/crm-foundation/PLAN.md#crm-s2
- **relation_mode**: body-links
- **tdd_target**: `tests/e2e-deps.test.ts`: con `E2E_FAKE_JOBS=1`, `resolveDeps('sync_interactions').fetchReactions(['u'],1)` ritorna gli item della fixture e `HANDLERS.sync_interactions({__fixture:'FAIL'}, deps)` rigetta con messaggio che inizia per `actor:`.
- **review_mode**: cli

## 14. Gate di validazione per ondata

| Wave | Gate |
|---|---|
| W1 | Dopo **T3**: `npm run typecheck` + `npx vitest run` verdi (4 test superstiti adattati + `purge-guard` + `schema` + `app-skeleton`); `web` build+typecheck verdi; brain senza link rotti; SDK ≥ 0.126 con `output_config` tipizzato. |
| W2 | Test API T4/T5/T6 e mapper T7 verdi; `actors.ts` con nomi campo company-employees confermati e commentati. |
| W3 | T8–T11 verdi con deps fake; smoke reale **opzionale e manuale** a cap minimi (`POSTS_PER_SYNC=1`, `REACTIONS_PER_POST=20`, `maxItems=3`, 1 analisi) per confermare gli schemi attuali degli actor e la risposta strutturata del modello. |
| W4 | T12 verde; T13 builda e l'onboarding è visibile a DB vuoto; `npm run e2e:server` (T20) risponde e popola l'Inbox da fixture. |
| W5–W6 | Scenari agent-browser di T14/T15/T16/T19 passati contro T20. |
| W7 | T18 completo (happy + unhappy); README/AGENTS aggiornati; `docs-maintenance` può ingerire (fuori piano). |

## 15. Questioni aperte (non bloccanti)

- **Nomi campo input di `harvestapi/linkedin-company-employees`**: da confermare in T7 (rischio noto).
- **Reazioni "anonime"**: quota di reactor senza `profile_url` sconosciuta finché non si fa uno smoke
  reale; se alta, valutare `atomus/linkedin-reactions-scraper-pro` come alternativa dietro lo stesso
  adapter.
- **Prezzo `profile-detail`**: valorizzare `PRICE_PROFILE_DETAIL_USD` dopo il primo smoke reale (fino ad
  allora la preview dice "stima non disponibile").
- **Fit ICP in Inbox** con più ICP: `IcpPickerDialog` chiede; con un solo ICP auto-seleziona (T15).
- **Lookalike Apollo / invio Brevo**: fuori piano; seam documentati nel contract, nessun file vuoto.
- **`markContacted` in export**: default off; alzare se l'uso reale lo suggerisce.
- **Progresso parziale dei job** ("12/22"): non in v1; il banner mostra solo durata.
