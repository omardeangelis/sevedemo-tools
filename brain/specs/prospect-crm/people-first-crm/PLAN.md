---
domain: prospect-crm
type: plan
spec: people-first-crm
links:
  - "[[specs/prospect-crm/people-first-crm/SPEC|SPEC]]"
  - "[[specs/prospect-crm/people-first-crm/FLOW|FLOW]]"
  - "[[specs/prospect-crm/prospect-crm-specs|prospect-crm-specs]]"
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[tech-debt/prospect-crm/crm-foundation|tech-debt crm-foundation]]"
created: 2026-09-18
updated: 2026-09-19
---

# PLAN — CRM centrato su Persone e Aziende (`people-first-crm`)

**Status:** Done — M1 completata (2026-09-18), M2 completata (2026-09-19), M3 completata (2026-09-20). Gate `adversarial-verifier`: DO NOT SHIP ×3 (MAJOR assorbiti: isolamento di T2 dal DB reale, strumenti dei run degli stop, file WAL) → **SHIP** (4° passaggio, 2026-09-18); MINOR finale (controllo del server alla ripresa di tappa) e NIT applicati senza re-gate.
**Execution mode:** `sequential` (grill G-3): un task alla volta nell'ordine di §8. Il lavoro è diviso in **tre
tappe** (G-2): **M1** Persone e contatti manuali (T0–T16) · **M2** Seguire le persone (T17–T27) · **M3** Connessioni
(T28–T36). Ogni tappa chiude con i 4 gate verdi e uno smoke `agent-browser`; **`implement-spec` si ferma alla fine di
ogni tappa e aspetta il via dell'utente** prima della successiva (§15). Ogni task server è un tracer bullet RED→GREEN
in vitest; ogni task FE si valida con `npm --prefix web run build` + `npm --prefix web run typecheck` +
`agent-browser` contro il server e2e finto (`E2E_FAKE_JOBS=1`).

> Contratto: [[specs/prospect-crm/people-first-crm/SPEC|SPEC.md]] (criteri A1–K5, Constraints, Data model) e
> [[specs/prospect-crm/people-first-crm/FLOW|FLOW.md]] (route, percorsi A–I, error path, edge case, testi, accessibilità:
> fanno parte della superficie di accettazione). Dove il piano sceglie tra alternative lasciate aperte, lo dice nel
> ledger (§4, decisioni `P-*`, contestabili).

---

## 1. Situazione iniziale e findings dal codice

- **Git**: `origin/main` = `0967f2f` (merge della PR #5 `apollo-lookalike`, identico a `14897c5`); il `main` locale è
  indietro (`7a33339`) e va solo portato avanti (fast-forward). Nel working tree ci sono solo modifiche del brain
  (SPEC/FLOW/PLAN nuovi, `index.md`, `log.md`, `prospect-crm-specs.md`).
- **Persone** (`prospects`, `src/db/schema.ts:193-217`): `linkedin_url TEXT NOT NULL UNIQUE`, `member_urn` unico se
  presente (`ux_prospects_member_urn`), anagrafica, `status` (9 stati, `status_changed_at`), `created_at`,
  `apollo_person_id`/`apollo_matched_at`. Nessuna traccia di "impostato a mano", nessuna prossima azione.
- **Scrittori dei job sui campi della persona** (tutti da toccare per D7/D8/E9):
  - `upsertProspect` (`src/db/prospects.ts:111`): backfill `COALESCE(col, ?)` oppure `{refresh}` `COALESCE(?, col)`,
    anche su `company_id` (sync, `source_company` con `refresh`, `apollo_people`, fake e2e);
  - `applyEnrichment` (`src/jobs/enrich.ts:275-310`): sovrascrive nome, headline, About, località, azienda testuale,
    ruolo; email/telefono solo se vuoti; `company_id = COALESCE(company_id, ?)`;
  - `applyApolloMatch` (`src/enrich/apollo-match.ts:57`): email, ruolo e azienda testuale solo se vuoti;
  - `mergeProspects` (`src/db/identity.ts:148`): backfill `FILL_COLUMNS` + stato dal cambio più recente +
    `created_at` minimo; chiamato da `resolveProspect`/`setProspectIdentity` (unioni automatiche);
  - `mergeCompanies` (`src/db/company-identity.ts:84`) sposta `company_id` sull'azienda che resta (stessa azienda: P-3).
- **Identità**: `identityKeys`/`resolveProspect`/`applyIdentity`/`setProspectIdentity`/`nameTwin` in
  `src/db/identity.ts`; `nameTwin` (69-80) confronta le forme dell'URL e oggi aggancerebbe per nome+headline anche una
  riga senza URL (TD-26).
- **Ricerca persone** (`buildQuery`, `src/db/prospects.ts:703-796`): filtri `q` (nome, headline, azienda testuale,
  ruolo, email, URL), `status`, `listId`, `companyId` (collegata **o** fonte sull'azienda, 720-723), `hasEmail`,
  `enriched`, `source`, `postId`, `fit` (via `analysisStateSql`, 477-501), `inbox`, `includeDiscarded`; sort
  `recent`/`comments_first`/`most_interactions`/`fit`. `hydrateRows` costruisce le righe; `idsByFilters` la selezione
  "tutte le filtrate" (cap 500). API in `src/server/routes/prospects.ts` (`/inbox`, `/inbox/ids`, `/prospects`,
  `/prospects/ids`, bulk status, PATCH con `EDITABLE_PROSPECT_FIELDS`, touchpoint, note, delete attività). Le richieste
  usano camelCase (`listId`, `occurredAt`), le risposte i nomi di colonna.
- **Attività** (`activities`): kind `status_change`, `touchpoint`, `note`, `export`, `analysis`, `enrichment` (CHECK);
  `note` e `touchpoint` eliminabili; nessuna modifica di una nota.
- **Job**: tabella `jobs` (kind con CHECK su `JOB_KINDS`, `state`, `pid`, `params`, `result`, `error`), controller
  `src/server/jobs.ts` (`startJob`, `runningJob`/`reconcileRunning`, `retryJob` con `CONFIG_BLOCKERS`, `launchJob`),
  figlio `src/server/job-entry.ts` (`runJob` scrive l'esito); stdout/stderr del figlio finiscono nella console del
  server (`jobs.ts:120-124`): **nessun log**. Registry `src/jobs/handlers.ts` (`HANDLERS`, `REAL_DEPS`,
  `CONFIG_BLOCKERS`). Errori prefissati `actor:<id>:` (Apify: id dell'actor; Apollo: `actor:apollo:<op>:`; modello:
  `actor:<ANALYSIS_MODEL>:`), `config:`, `process:` (`src/jobs/errors.ts`). Le preview sono costruite nelle route
  (`buildPreview` in `routes/analyze.ts`, …) sopra le funzioni `plan*` dei kind (`planAnalysis`, `planEnrichment`,
  `previewSync`, `planEnrichCompanies`, `planLookalike`, `planContacts`, …). `result.counts` di `analyze` ha
  `enriched_first`.
- **Analisi singola**: `POST /prospects/:id/analyze` (`src/server/routes/analyze.ts:78-104`) sincrona, nessuna riga
  `jobs`.
- **Migrazioni**: `applySchema` → `migrateSchema` (piano `planSchemaMigration`, una sola copia `backupDatabase`, una
  transazione con `foreign_keys=OFF`, `rebuildTableSteps`, `foreign_key_check`) → `exec(SCHEMA)` (tabelle e indici
  `IF NOT EXISTS`). `foreign_keys = ON` per connessione (CASCADE attivi). Fixture `tests/fixtures/schema-crm-foundation.sql`.
- **Frontend**: route `/` (onboarding a 3 passi + redirect all'Inbox, TD-38), `/inbox`, `/lists`, `/lists/$id`,
  `/icps`, `/icps/$id`, `/companies`, `/companies/$id` ("Prospect collegati"), `/prospects/$id`, `/settings` (Profilo,
  Azienda, Configurazione, Post, Ultimi job). Sidebar `NAV` in `web/src/routes/__root.tsx` con `JobBanner`.
  `ProspectTable`, `BulkBar` (+ `EnrichDialog`), `AnalysisCard`, `TouchpointForm`, `Timeline`, `JobPreviewDialog`,
  `ListPicker`; hook job in `web/src/lib/jobs.ts` (`useCurrentJob` con polling solo a job `running`, TD-10;
  `useRetryJob` → `POST /jobs/:id/retry` senza preview, TD-25 residuo).
- **Server e2e**: `scripts/e2e-server.ts` (`POST /api/e2e/reset|seed`), `src/jobs/fake-deps.ts` (`seedE2eData`, deps
  finte, trigger `__fixture`/parole chiave), `tests/e2e/README.md`.
- **Debito aperto rilevante**: TD-38 (home → Inbox: lo chiude H1 in M2), TD-25 residuo (Riprova senza preview: lo
  chiude J12 all'inizio di M2), TD-26 (aggancio per nome: T4 esclude le persone senza LinkedIn), TD-30
  (`SQLITE_BUSY`: le scritture nuove usano `.immediate()`, P-17), TD-10 (banner che non scopre job avviati altrove:
  fuori scope).

## 2. Problema

Oggi l'utente non trova i contatti (l'Inbox perde chi entra in una lista), non può aggiungere a mano chi conosce agli
eventi né collegarlo a un'azienda, vede i propri dati riscritti dagli arricchimenti, non può esprimere il proprio fit né
ricordarsi quando ricontattare qualcuno, e quando un job fallisce non ha log né una vista per strumento. Serve ripensare
la navigazione attorno a Persone e Aziende (SPEC A–K) senza perdere dati reali in `data/crm.db` e senza spese nuove.

## 3. Forma della soluzione

- **Dati** (M1, una sola migrazione per tutte le tappe, P-1): `prospects` ricostruita (URL LinkedIn facoltativo, CHECK
  "almeno un recapito", `manual_fields`, prossima azione), `activities` ricostruita (kind `fit_change`,
  `next_action_done`), tabelle `manual_fits` e `run_logs`, colonne `jobs.detached|logged|tools`.
- **Dati a mano** (`src/db/manual-fields.ts`, deep module): marcatura su ogni scrittura dell'utente + un solo helper SQL
  usato da **tutti** gli scrittori dei job, così D7/D8/D9/E9/E10 valgono ovunque.
- **Persone manuali** (`src/db/people.ts` + `src/server/routes/people.ts`): creazione, controllo doppioni, "Aggiungi
  l'incontro", collegamento all'azienda; `src/db/person-merge.ts`: nucleo dell'unione con la regola manuale (E6–E8) e
  quella automatica (E9); `src/db/next-actions.ts` + `routes/next-actions.ts`.
- **Ricerca e viste** (`buildQuery` esteso): viste Tutte / Da smistare / Con prossima azione / Scartate, filtri e
  ordinamenti nuovi, conteggi per vista; una sola definizione del filtro testo per Persone e ⌘K (P-18).
- **Seguire** (M2): "Riprova" dalla preview (`previewFromParams` per kind), `src/db/fits.ts` (fit manuale +
  espressione unica del fit effettivo), `src/db/search.ts`, `src/db/today.ts`, router `fits`, `search`, `today`.
- **Run** (M3): `src/runs/log.ts` (logger ambientale per run, persistito, troncato al centro), `src/runs/tools.ts`
  (strumenti, esito, attribuzione dell'errore), `src/db/runs.ts` + `src/server/routes/runs.ts` (Connessioni, run per
  strumento, dettaglio, log); analisi singola come run `detached`.
- **Frontend**: sidebar Contatti (Persone, Aziende) · Prospecting (Liste, ICP) · Impostazioni in M1, + Cerca ⌘K e Oggi
  in M2 (P-22); route `/people`, `/people/new`, `/people/$id`, `/settings/{profile,posts,connections}`,
  `/settings/connections/$tool`, `/settings/connections/runs/$runId`; redirect da `/inbox`, `/prospects/$id`,
  `/settings`.

## 4. Decision ledger

### Decisioni di prodotto (SPEC, 2026-09-18)

Registrate nel Decision Log della SPEC: navigazione Oggi · Contatti · Prospecting · Impostazioni; "persona" al posto di
"prospect"/"Inbox"; persona manuale = nome + un recapito; identità = URL LinkedIn + id membro (email solo controllo
doppioni, telefono mai chiave); unione manuale con anteprima (resta la scheda aperta), unioni automatiche che
conservano i dati a mano; evento = fonte "aggiunta a mano" + nota; Da smistare esclude i manuali; dati a mano non
riscritti dai job; fit manuale per ICP che vince sull'AI; una prossima azione per persona; home Oggi (chiude TD-38);
Connessioni con run e log, chiavi nel `.env`; "Riprova" dalla preview (chiude TD-25 residuo); P1–P11 del FLOW accolte.

### Decisioni del grill (2026-09-18, con l'utente)

| # | Decisione | Conseguenza nel piano |
|---|---|---|
| G-1 | Base git: branch `people-first-crm` da `origin/main` (`0967f2f`, apollo-lookalike già unito), dopo il fast-forward del `main` locale | T0 |
| G-2 | Tre tappe in un solo PLAN (M1 → M2 → M3), **stop dopo ogni tappa** in attesa del via | §8, §15 |
| G-3 | Esecuzione `sequential` | Nessun task di pre-cablaggio per il parallelismo; i file condivisi (`app.ts`, `handlers.ts`, `web/src/api/*`, `__root.tsx`) li edita il task che ne ha bisogno, uno alla volta |
| G-4 | Log: tutti finché esiste il run; 5.000 righe per run, troncamento che tiene inizio e fine (SPEC J11 confermata) | T28 |
| G-5 | Prova della migrazione su una **copia temporanea** di `data/crm.db` eseguita dall'agente (conteggi, `foreign_key_check`, idempotenza; originale mai aperto in scrittura; copia cancellata; nel log solo numeri) | T2 |

### Decisioni prese in pianificazione (derivate da SPEC/FLOW/codice; contestabili)

| # | Decisione | Perché |
|---|---|---|
| P-1 | **Una sola migrazione in M1** con lo schema di tutte e tre le tappe (colonne/tabelle di M2–M3 inutilizzate fino ad allora) | Una sola ricostruzione di `prospects`/`activities`, un solo backup, una sola prova sulla copia reale (G-5); le tappe successive non toccano lo schema |
| P-2 | `prospects.linkedin_url` nullable + indice unico **parziale** `ux_prospects_linkedin`; CHECK `linkedin_url IS NOT NULL OR email non vuota OR telefono non vuoto`; indice su `lower(trim(email))` per il controllo doppioni | E1, E2, E4 anche nel DB; nessun vincolo d'unicità sull'email (E1) |
| P-3 | Dati a mano = `prospects.manual_fields` JSON `{colonna: iso}` (colonne anagrafiche + `company_id`): chiave presente = impostato o svuotato a mano, con la data (serve a E9); assente = mai toccato. I job scrivono **solo** via `jobAssign(col, valueSql)` di `src/db/manual-fields.ts` (`CASE WHEN json_type(manual_fields, '$.<col>') IS NOT NULL THEN <col> ELSE <valueSql> END`). `mergeCompanies` continua a spostare `company_id` (stessa azienda) | Un solo punto per D7/D8 su quattro scrittori; la data rende possibile "vince il più recente" di E9 |
| P-4 | Date di calendario (`next_action_on`, data dell'incontro) in `YYYY-MM-DD`; "oggi" arriva dal client (`today=YYYY-MM-DD`, default: data locale del server); la **nota** dell'incontro ha `occurred_at` = `<data>T12:00:00.000Z`; la **fonte** `manual` tiene `captured_at` = momento dell'inserimento (così "fonti più recenti" di B8 la tratta come appena ricevuta) e la data dell'incontro in `raw_json.met_on`, mostrata come *"Aggiunta a mano · incontro del 12 set"* | Fuso del computer dell'utente (SPEC Terminologia); a mezzogiorno UTC la data non cambia in nessun fuso ±11 h; i test fissano `today`; chi inserisco oggi per un evento del mese scorso non finisce in fondo all'ordinamento di default |
| P-5 | Contesto dell'incontro = attività `note` con `meta.meeting = {met_on}`; la ricerca testo (B5/I2) fa `EXISTS` sulle sole note con `meta.meeting` (indice parziale); eliminare la nota la toglie dalla ricerca | SPEC Data model; nessuna colonna di testo duplicata |
| P-6 | Nuovi kind attività `fit_change` (meta `{icp_id, icp_name, from, to}`, body = motivazione) e `next_action_done` (body = testo) → ricostruzione di `activities` (CHECK) | F7, G4 in timeline con tipi propri |
| P-7 | Fit manuale in `manual_fits (prospect_id, icp_id)` PK, `ON DELETE CASCADE` su entrambi | F10 gratis; al più uno per coppia |
| P-8 | Path API invariati (`/api/prospects…`: nel codice resta "prospect"); le novità in router nuovi: `people.ts` (crea, doppioni, incontri, azienda, unione), `next-actions.ts`, `fits.ts`, `search.ts`, `today.ts`, `runs.ts`. `/api/inbox` resta come alias della vista Da smistare. UI su `/people…` | Una route per file; test esistenti validi; "prospect" sparisce solo dal testo visibile (A3) |
| P-9 | Origine della scheda (A7) = search param `from` con path+query **interni**: ammessi solo `/` esatto (Oggi), `/people`, `/lists/<id>`, `/companies/<id>`, ciascuno con la sua query string (filtri e pagina); rifiutato tutto ciò che inizia con `//` o contiene uno schema; altrimenti ignorato | Sopravvive al reload; nessun open redirect (`//evil.example` è un URL esterno per il browser) |
| P-10 | Log dei run in `run_logs (job_id, seq)`, scritti dal processo che esegue il run (figlio per i job, server per l'analisi singola) con un logger ambientale (`AsyncLocalStorage`) e flush a lotti (≤ 500 ms o 50 righe) in transazioni `.immediate()`; un errore di scrittura del log **non** fa fallire il run; troncamento al centro (tiene `seq ≤ 2.500` e le ultime 2.500; omesse = `MAX(seq) − COUNT(*)`); ogni messaggio al più 2.000 caratteri (oltre: troncato con "…"), così un run occupa al più ~10 MB; `jobs.logged = 1` per i run nuovi ("Log non disponibile" sugli storici); redazione difensiva dei valori delle chiavi configurate | J8–J11 persistiti al riavvio, senza file sparsi; contesa SQLite contenuta (TD-30) |
| P-11 | Le righe delle chiamate agli strumenti si scrivono **negli handler** al confine delle `Deps` (reali e fake loggano uguale); i client loggano solo retry e attese da rate limit | Stessi log nel server e2e; nessun payload nei log (J10) |
| P-12 | Strumenti di un run = `jobs.tools` (JSON) fissato all'avvio da `toolsOf(params)` di ogni kind (registry `RUN_TOOLS`); backfill SQL degli storici nella migrazione. Esito (`runOutcome`) e strumenti colpiti (`failedTools`) = funzioni pure lato server, usate da Connessioni, Oggi e FE | J3 è un fatto del run (come i `params`), non uno stato derivato; attribuzione J4 testabile in vitest |
| P-13 | Analisi singola = riga `jobs` kind `analyze`, `detached = 1`, `params.single = true`, `pid` del server; esclusa da "un job alla volta", da `/jobs/current` (banner) e da "Riprova" (409 `not_retryable`); nasce **solo** se l'analisi chiama uno strumento (hook prima della prima chiamata); al riavvio del server una `detached` `running` diventa `failed` ("interrotta dal riavvio del server") | J15 senza cambiare banner e regola del job unico; J13 |
| P-14 | "Riprova" = `GET /api/jobs/:id/retry-preview` (preview da `previewFromParams(params)` del kind, registry `RETRY_PREVIEWS`, + blocker "job in corso") → "Avvia" = `POST /api/jobs/:id/retry` invariato (ricontrolla i blocker) | J12 sul server con gli stessi conteggi/stima/blocchi della preview del kind; chiude TD-25 residuo |
| P-15 | Promemoria nascosti di Oggi (H7) in `localStorage` con la firma dell'insieme delle voci mancanti (firma diversa → tutti visibili), letture/scritture in `try/catch` | Preferenza per-browser, single-user; niente schema per una preferenza di vista |
| P-16 | Home in M1 = onboarding a CRM vuoto, altrimenti redirect a `/people`; M2 la sostituisce con Oggi (H1) | Nessun redirect all'Inbox già da M1, senza anticipare Oggi |
| P-17 | Le transazioni di scrittura introdotte da questo piano usano `db.transaction(fn).immediate()` | TD-30: le azioni manuali avvengono mentre un job scrive |
| P-18 | Filtro testo di Persone e ricerca globale = la stessa funzione `personTextCondition(q)` (nome, headline, ruolo, azienda testuale **o nome dell'azienda collegata**, email, telefono, URL LinkedIn, contesto dell'incontro); aziende per nome, dominio, pagina LinkedIn. Perf test vitest su 10.000 persone e 2.000 aziende lato server + una misura in `agent-browser` (dall'ultimo tasto ai risultati) sul volume di `seed-bulk`; debounce della ricerca ≤ 100 ms con richieste superate annullate | B5 = I2 per costruzione; chi è collegato a "Nuvola Srl" dal form (senza nome testuale) si trova cercando "nuvola"; il budget di 300 ms della SPEC si misura dove lo sente l'utente |
| P-19 | Unione manuale (E6–E8) e automatica (E9) in `src/db/person-merge.ts` con due regole esplicite su un nucleo comune (fonti, liste, attività, analisi, fit manuali, prossima azione, `manual_fields`); `mergeProspects` di `identity.ts` delega al nucleo con la regola automatica | Un solo posto dove si spostano i dati |
| P-20 | Nessuna dipendenza nuova: ⌘K con il Dialog Radix + listbox propria; un solo combobox per azienda e persona | Regola del repo |
| P-21 | I testi dell'interfaccia (A3) cambiano anche nei messaggi d'errore API mostrati all'utente ("Persona non trovata.") e nei riassunti/warning dei **nuovi** run (anche `src/jobs/analyze.ts:204,249,371`, sync, "Sourcing da azienda" → "Persone di un'azienda"); i riassunti storici restano come sono | A3 include messaggi ed esiti dei job |
| P-22 | (ux-advisor) Sidebar di M1 **senza** "Oggi" e senza "Cerca ⌘K" (il marchio "CRM personale" porta a `/`): arrivano in M2 con le loro pagine (T22, T26). A1 e I1 sono parziali fino a M2 | Nessuna voce che porta alla pagina sbagliata allo stop di M1 |
| P-23 | Trigger e2e dei fallimenti non raggiungibili dalla UI solo in `scripts/e2e-server.ts`, come app Hono **esterna** montata davanti a `createApp()` (un `app.use` dopo `createApp()` non vede le route già registrate): `POST /api/e2e/fail-next {method, path, status?, times?}` fa fallire le prossime `times` (default 1) richieste corrispondenti, con `path` confrontato **senza** query string e regole azzerate da `/api/e2e/reset` (salvataggio, Unisci, fit, prossima azione, collega/scollega, ricerca, polling del log, caricamento di una pagina); `times` si sceglie per riga: 2 per le GET fatte con React Query e i suoi default (`web/src/main.tsx`, `retry: 1`), 1 per mutation, fetch manuali (ricerca ⌘K con `AbortController`) e query con `retry: false` (`web/src/lib/jobs.ts`), così il primo "Riprova" riesce; `POST /api/e2e/seed-bulk` genera il volume del perf (10.000/2.000); `LOG_FLOOD` e run lenti nelle deps finte; mai nelle route di produzione | Ogni riga d'errore del FLOW percorribile nello smoke, senza codice di test nel prodotto |
| P-24 | (ux-advisor) Fino a M3 i link verso le Impostazioni usano `/settings#profilo`, `/settings#azienda`, `/settings` (dopo T31 restano validi grazie al redirect di A5) | Nessun link a route che non esistono ancora |
| P-25 | (ux-advisor) In M1 la prossima azione si imposta, modifica e rimuove (G1 senza timeline) e si mostra come scaduta/oggi/futura (G3) in scheda e in Persone; Fatto, Rimanda e touchpoint (G2, G4, G5) in M2 | Una data sbagliata inserita dal form di M1 non resta bloccata fino a M2 |
| P-26 | (ux-advisor) "Riprova" dalla preview all'**inizio di M2** (T17–T18), sul banner e su "Ultimi job" attuali; M3 riusa lo stesso dialog | Negli stop di M1/M2 l'utente prova sui dati veri: niente spese senza preview più a lungo del necessario |
| P-27 | Ordinamento "data di aggiunta" = `sort=added` (`created_at` desc): B8 lo richiede ma la lista `sort` del FLOW (Entry points) non lo nomina | Estensione dichiarata del FLOW, da riportare con `docs-maintenance` |
| P-28 | (gate) Gli strumenti dei run creati durante gli stop di M1/M2 (`tools = '[]'`) si riempiono con un `fillMissingRunTools` idempotente chiamato in `src/server/index.ts` prima di `serve` (non in `app.ts`), da M3 in poi (T30), non solo col backfill della migrazione | Altrimenti quei run mancherebbero da Connessioni (J2, J6), dalla salute (J5) e dagli avvisi di Oggi (H5) |

## 5. Assunzioni e vincoli

- Mai chiamate reali ad Apify, Anthropic o Apollo in test e validazione; e2e solo con `E2E_FAKE_JOBS=1`; mai toccare
  `data/` da test ed e2e (unica eccezione: la **lettura** di `data/crm.db` in T2 per farne una copia, G-5).
- Stop di ogni server/Vite/`agent-browser` avviato **per PID**; Vite va riavviato dopo aver creato file di route nuovi
  (Tailwind); `routeTree.gen.ts` non si edita.
- Nel codice e nell'API resta la parola `prospect` (tipi, tabelle, path); "persona" solo nel testo visibile (A3, P-8).
- Nessuna dipendenza nuova (P-20). Testi, commenti e messaggi in italiano.
- "Oggi" e le date della prossima azione seguono il fuso del computer dell'utente (P-4); server e browser girano sulla
  stessa macchina.
- Assunzione: al primo avvio dopo l'aggiornamento nessun job gira su `data/crm.db` (altrimenti la migrazione rifiuta il
  backup e il server non parte: comportamento esistente, messaggio già chiaro).
- Assunzione: `data/crm.db` non contiene righe di `prospects` con `linkedin_url` vuoto `''` (lo verifica T2).
- Durante l'implementazione nessun server resta acceso su `data/crm.db`: i figli dei job partirebbero dal working tree
  nuovo e, trovando lo schema da migrare, rifiuterebbero il backup (il loro stesso pid è vivo) facendo fallire i job.
  Il 2026-09-18 l'utente ha chiesto all'agente di fermare lui il server reale: fatto quel giorno (`pnpm ui` →
  `concurrently` con API + Vite, SIGINT al pid di `concurrently`, nessun figlio `job-entry` vivo, `lsof` vuoto dopo).
  Alla ripresa di ogni tappa (T0, T17, T28) l'agente ripete il controllo e, se trova il server reale acceso, **lo ferma
  da sé** allo stesso modo, per PID e mai con `pkill -f`: prima verifica che non ci siano figli `job-entry` vivi (un job
  in corso non si interrompe: si aspetta che finisca e lo si dice all'utente), poi controlla che `lsof` sul DB reale sia
  vuoto. Il controllo serve anche dopo M1: da lì nessun figlio rifiuta più di partire da codice a metà. L'utente riavvia
  il server reale solo agli stop di tappa (il primo avvio dopo M1 migra, con backup).

## 6. Modello dati (delta DDL, T1)

```sql
-- prospects: RICOSTRUITA (linkedin_url passa da NOT NULL UNIQUE a facoltativo; nuovi vincoli e colonne)
CREATE TABLE IF NOT EXISTS prospects (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  linkedin_url            TEXT,        -- identità (E1): normalizeLinkedinUrl(); unica se presente (indice parziale)
  member_urn              TEXT,
  full_name TEXT, headline TEXT, about TEXT, location TEXT, email TEXT, phone TEXT,
  company_id              INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  company_name TEXT, title TEXT,
  raw_json                TEXT CHECK (json_valid(raw_json)),
  enriched_at TEXT, enrichment_attempted_at TEXT,
  status                  TEXT NOT NULL DEFAULT 'nuovo' CHECK (status IN (…PROSPECT_STATUSES)),
  status_changed_at TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime(…)),   -- "data di aggiunta"
  updated_at              TEXT NOT NULL DEFAULT (strftime(…)),
  apollo_person_id TEXT, apollo_matched_at TEXT,
  -- people-first-crm
  manual_fields           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(manual_fields)),  -- {colonna: iso} (P-3)
  next_action_on          TEXT CHECK (next_action_on IS NULL OR date(next_action_on) = next_action_on),
  next_action_text        TEXT,
  next_action_set_at      TEXT,
  CHECK (linkedin_url IS NOT NULL OR TRIM(COALESCE(email, '')) <> '' OR TRIM(COALESCE(phone, '')) <> ''),
  CHECK (next_action_on IS NOT NULL OR (next_action_text IS NULL AND next_action_set_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_prospects_linkedin ON prospects(linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_email_ci ON prospects(lower(trim(email))) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_next_action ON prospects(next_action_on) WHERE next_action_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_created ON prospects(created_at);
-- (restano: ux_prospects_member_urn, ux_prospects_apollo_person, idx_prospects_name/status/company)

-- activities: RICOSTRUITA solo per il CHECK del kind (+ 'fit_change', 'next_action_done')
CREATE INDEX IF NOT EXISTS idx_activities_meeting ON activities(prospect_id)
  WHERE kind = 'note' AND json_extract(meta, '$.meeting') IS NOT NULL;

-- fit manuale per coppia persona–ICP (F, P-7)
CREATE TABLE IF NOT EXISTS manual_fits (
  prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  icp_id      INTEGER NOT NULL REFERENCES icps(id) ON DELETE CASCADE,
  fit         TEXT NOT NULL CHECK (fit IN ('alto', 'medio', 'basso')),
  reason      TEXT,
  set_at      TEXT NOT NULL,
  PRIMARY KEY (prospect_id, icp_id)
);
CREATE INDEX IF NOT EXISTS idx_manual_fits_icp ON manual_fits(icp_id);

-- log dei run (J8–J11, P-10)
CREATE TABLE IF NOT EXISTS run_logs (
  job_id  INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  at      TEXT NOT NULL,
  level   TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
) WITHOUT ROWID;

-- jobs: colonne ADDITIVE (ALTER guardato; stesse colonne, in coda, in JOBS_TABLE per i DB nuovi)
--   detached INTEGER NOT NULL DEFAULT 0   -- analisi singola: non blocca, non è nel banner (P-13)
--   logged   INTEGER NOT NULL DEFAULT 0   -- 1 = run con log (i precedenti: "Log non disponibile")
--   tools    TEXT NOT NULL DEFAULT '[]'   -- strumenti del run (P-12); backfill degli storici:
--     sync_interactions|source_company → ["apify"]; enrich → provider apollo ? ["apollo"] : ["apify"];
--     analyze → ["anthropic"] + "apify" se result.counts.enriched_first > 0 oppure se l'errore viene da un actor
--       Apify (id tra `actor:` e il `:` successivo nella forma `<owner>/<name>`) o nomina APIFY_TOKEN;
--     kind Apollo → ["apollo"]
```

**Piano di migrazione** (`planSchemaMigration`): `prospects` (ricostruzione se `linkedin_url` ha ancora `notnull = 1`),
`activities` (`enumCheckOutdated(ACTIVITY_KINDS)`), `jobsColumns` (colonne mancanti → `ALTER` + backfill `tools`).
Tabelle nuove e indici li crea `exec(SCHEMA)` dopo la migrazione (gli indici su colonne nuove esistono solo dopo la
ricostruzione). Stessa procedura di apollo-lookalike: un solo `backupDatabase`, una transazione con
`foreign_keys=OFF`, `foreign_key_check` finale, no-op (niente backup) su DB nuovi o già migrati. I campi presenti al
momento della migrazione non risultano "a mano" (`manual_fields = '{}'`).

## 7. Ricerca esterna usata

Nessuna libreria nuova. Comportamenti verificati nel codice o nella documentazione ufficiale:

- SQLite: indici unici e indici su espressione parziali (`CREATE INDEX … WHERE`), `json_type`/`json_extract` in
  espressioni d'indice (deterministiche), `ALTER TABLE ADD COLUMN` con `NOT NULL DEFAULT` costante, `WITHOUT ROWID`,
  procedura di ricostruzione a 12 passi (già in `rebuildTableSteps`).
- Node: `AsyncLocalStorage` (`node:async_hooks`) per il logger ambientale del run. SQLite in WAL (verificato al gate
  con il `better-sqlite3` del repo): anche un'apertura `readonly` crea `-wal`/`-shm` accanto al file; `?immutable=1` non
  è supportato come path; un processo che esce senza `close()` lascia i dati nel `-wal`; copiare il solo `.db` dà "no
  such table", copiare la coppia `.db` + `-wal` (senza `-shm`) a processi fermi dà una copia integra. T2 fa così.
- TanStack Router: redirect in `beforeLoad` (`throw redirect({ to, search, hash, replace: true })`), segmenti statici
  prioritari sui parametri (`/settings/connections/runs/$runId` vs `/settings/connections/$tool`).

## 8. Grafo delle dipendenze e ordine di esecuzione

Esecuzione sequenziale nell'ordine della tabella. Il grafo sotto riporta i `depends_on` (una freccia = "serve a"),
così si vede cosa si rompe se un task slitta.

```
M1  T0 → T1 → T2 ───────────────────────────────────────────────────────────────→ T16
          T1 → T3 → T4 ─────────→ T7
               T3 → T5 → T6 ─────────────────────────────→ T11
                    T5 → T7 → T9
                    T5 → T8 → T9 → T10 → T11 → T15 ──────────────────────────────→ T16  ⏸ stop M1
                         T8 ──────→ T10 → T12 → T13 → T14 ───────────────────────→ T16
                                    T10 ────────→ T13
M2  T16 → T17 → T18 ───────────────────────────────────────────→ T27
    T16 → T19 → T20 ───────────────────────────────────────────→ T27
    T16 → T21 → T22 ─────────────────────────────→ T26 ────────→ T27  ⏸ stop M2
    T16 → T23 → T24 ─────────────────────────────→ T26
          T23 → T25 ─────────────────────────────→ T26
M3  T27 → T28 → T29 ─────────────────────→ T33, T36
          T28 → T30 → T31 → T32 → T33 → T34 → T35 → T36  ⏸ fine
```

| Ordine | Task | Tappa | depends_on |
|---|---|---|---|
| 1 | T0 Base git e baseline | M1 | — |
| 2 | T1 Schema e migrazione unica | M1 | T0 |
| 3 | T2 Verifica della migrazione sulla copia del DB reale | M1 | T1 |
| 4 | T3 Scritture manuali: anagrafica "a mano", azienda, prossima azione (API) | M1 | T1 |
| 5 | T4 I job rispettano i dati a mano | M1 | T3 |
| 6 | T5 Aggiungi persona: creazione, doppioni, incontro (API) | M1 | T3 |
| 7 | T6 Persone senza LinkedIn nei job e nell'export | M1 | T5 |
| 8 | T7 Modifiche d'identità e Unisci (API) | M1 | T4, T5 |
| 9 | T8 Persone: viste, filtri, ordinamenti, conteggi (API) | M1 | T5 |
| 10 | T9 Seed e2e di M1 e trigger d'errore | M1 | T5, T7, T8 |
| 11 | T10 FE fondazione: client, sidebar, percorso, route e redirect | M1 | T8, T9 |
| 12 | T11 FE pagina Persone | M1 | T10, T6 |
| 13 | T12 FE pagina Aggiungi persona | M1 | T10 |
| 14 | T13 FE scheda persona (azienda, dati a mano, prossima azione) e scheda azienda | M1 | T10, T12 |
| 15 | T14 FE LinkedIn, conflitti d'identità e Unisci | M1 | T13 |
| 16 | T15 Onboarding a tre strade, home di M1, testi (A3) | M1 | T11 |
| 17 | T16 Smoke M1 e documenti di tappa | M1 | T2, T6, T11–T15 |
| 18 | T17 "Riprova" dalla preview (API) | M2 | T16 |
| 19 | T18 FE "Riprova…" con preview (banner, Ultimi job) | M2 | T17 |
| 20 | T19 Fit manuale e fit effettivo (API) | M2 | T16 |
| 21 | T20 FE fit: card, colonna, filtro, Elimina ICP | M2 | T19 |
| 22 | T21 Ricerca globale (API) + perf | M2 | T16 |
| 23 | T22 FE ricerca ⌘K + bottone Cerca | M2 | T21 |
| 24 | T23 Prossima azione: Fatto, Rimanda, touchpoint (API) | M2 | T16 |
| 25 | T24 FE Fatto, Rimanda, touchpoint | M2 | T23 |
| 26 | T25 Oggi (API) | M2 | T23 |
| 27 | T26 FE Oggi come home + voce Oggi | M2 | T25, T24, T22 |
| 28 | T27 Smoke M2 e documenti di tappa | M2 | T18, T20, T22, T24, T26 |
| 29 | T28 Logger dei run | M3 | T27 |
| 30 | T29 Righe di log in tutti i kind + trigger e2e | M3 | T28 |
| 31 | T30 Strumenti, esiti e API Connessioni | M3 | T28 |
| 32 | T31 FE Impostazioni in tre sezioni | M3 | T30 |
| 33 | T32 FE Connessioni e pagina strumento | M3 | T31 |
| 34 | T33 FE dettaglio run, log live, Riprova… | M3 | T32, T29 |
| 35 | T34 Oggi: run falliti + "Dettagli del run" in banner e toast | M3 | T33 |
| 36 | T35 Analisi singola come run | M3 | T34 |
| 37 | T36 Smoke M3, documenti e debito | M3 | T29, T35 |

## 9. Ordine consigliato dall'UX (ux-advisor, 2026-09-18) — recepito

Il pressure-test dell'ordine (su SPEC + FLOW) ha portato a queste scelte, già riflesse in §4 e §14:

- **Stati intermedi non confusi**: niente voce Oggi né Cerca in M1 (P-22); prossima azione gestibile già in M1 (P-25);
  link verso le Impostazioni che esistono (P-24); nessuna sezione "Avvisi" vuota in Oggi prima di M3 (T26); A3 copre
  anche i testi generati dal server e lo smoke lo verifica sul testo delle pagine (T15, T16).
- **Ansia "perdo i contatti"**: T1 → T2 per primi; T2 riporta anche i delta visibili (Inbox prima = Da smistare dopo;
  aziende la cui sezione Persone si accorcia per D5); allo stop di M1 si comunica il percorso del backup.
- **Ansia "un job riscrive quello che ho scritto"**: T5 marca a mano ogni campo del form e il collegamento
  all'azienda; T4 prima della creazione manuale, con `nameTwin` che ignora le righe senza LinkedIn e la regola E9 sulla
  prossima azione; T6 subito dopo T5 (dentro la stessa tappa: nessuno stop con persone senza LinkedIn non escluse dai
  job).
- **Ansia "spendo senza vedere"**: "Riprova" dalla preview anticipato all'inizio di M2 (P-26).
- **M2 a fette verticali** in ordine d'ansia: Riprova → fit → ricerca → prossima azione → Oggi; ogni fetta ha API + FE
  + dati di seed; l'unione dei fit manuali (E6/E9) sta nel task del fit (T19).
- **M3**: logger e righe di log per primi (ogni run lascia traccia al più presto), poi Connessioni, dettaglio, avvisi
  di Oggi e banner, e per ultima l'analisi singola come run.
- **Error path nello stesso task del percorso felice**: elencati nella `validation` di ogni task (non rimandati agli
  smoke). Gli smoke T16/T27/T36 percorrono i percorsi e le righe d'errore indicati dall'advisor.

## 10. Strategia di test

- **Server (vitest, interfacce pubbliche)**: HTTP con `createApp().request()`; DB per processo da `tests/setup.ts`;
  import dinamici. Job: `runJob(id, {handlers, resolveDeps})` in-process, deps finte iniettate; mai rete reale.
  Migrazione: fixture di schema `tests/fixtures/schema-crm-foundation.sql` + nuova `schema-apollo-lookalike.sql`
  (schema di `0967f2f`) con dati sintetici, conteggi per tabella prima/dopo, idempotenza.
- **Priorità dei comportamenti** (tdd, dal più importante): (1) nessun dato perso in migrazione; (2) i job non
  riscrivono i dati a mano (ogni scrittore); (3) nessun doppione silenzioso (LinkedIn blocca, email chiede); (4) Unisci
  non perde chiavi d'identità né dati a mano; (5) nessuna spesa senza preview ("Riprova"); (6) fit effettivo coerente
  tra colonna, filtro, ordinamento e CSV; (7) log senza segreti, persistiti, troncati al centro.
- **Perf** (Constraints): `tests/perf-people.test.ts` genera 10.000 persone, 2.000 aziende e contesti d'incontro nel DB
  del test e misura lato server: ricerca globale < 150 ms, prima pagina di Persone (Tutte, ordinamento di default) e
  conteggi delle viste < 500 ms (margine per HTTP locale e render sotto i 300 ms / 1 s della SPEC).
- **Frontend (agent-browser, server e2e finto)**: ogni task FE verifica i suoi percorsi FLOW e le sue righe d'errore;
  ogni tappa chiude con uno smoke (T16, T27, T36) che ripercorre i percorsi della tappa, `aria-current`, focus, testi
  (nessun "prospect"/"Inbox" nel testo delle pagine visitate, via `eval` su `document.body.innerText`) e redirect.
- **Gate** (verdi a fine di ogni task e di ogni tappa): `npm run typecheck` · `npm test` ·
  `npm --prefix web run build` · `npm --prefix web run typecheck`.

## 11. Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| La ricostruzione di `prospects` fallisce o perde righe sul DB reale (casi storici non coperti dalle fixture) | Backup automatico; fixture di entrambi gli schemi storici; T2 prova sulla copia reale (conteggi, FK, idempotenza) prima di ogni altra modifica; esito anomalo = stop e domanda all'utente |
| `linkedin_url` nullable rompe consumatori che lo danno per certo (enrich, analisi, export, e2e, FE) | Il tipo cambia in T5 e `npm run typecheck` guida i fix; T6 esclude esplicitamente i senza LinkedIn dai job (E11) nella stessa tappa; `nameTwin` ignora le righe senza URL (T4) |
| Uno scrittore dei job sfugge alla regola dei dati a mano | Un solo helper (P-3); T4 ha un test per **ogni** scrittore di §1; checklist `rg "UPDATE prospects\|upsertProspect("` nel log del task |
| Contesa SQLite tra server (azioni manuali, log dell'analisi singola) e figlio (job, log) | `.immediate()` sulle scritture nuove (P-17); log a lotti, errori di log non fatali (P-10) |
| Contesto `AsyncLocalStorage` perso in callback/stream dei client | Log delle chiamate negli handler (P-11), test per kind in T29; fuori contesto il logger è un no-op |
| Segreti nei log (chiavi, token, corpi) | Messaggi composti dagli handler (operazione + etichette), mai payload; redazione dei valori delle chiavi configurate; test J10 con chiavi finte riconoscibili |
| Persone lenta a 10k con le `EXISTS` nuove (contesto, prossima azione, fit) | Indici parziali (§6), perf test (T21) con soglie; conteggi delle viste in un'unica query aggregata |
| Stato intermedio confuso tra una tappa e l'altra | P-22, P-24, P-25, P-26 (§9) |
| Test esistenti che controllano testi vecchi ("Prospect non trovato.", "Inbox", "Sourcing da azienda") | Aggiornati nello stesso task che cambia il testo (T15, P-21) |
| ⌘K intercettato dal browser | `preventDefault` sul `keydown` a livello documento; bottone "Cerca" sempre disponibile (FLOW Edge ⌘K) |
| `previewFromParams` diverge dalla preview della route del kind | Le route chiamano la stessa funzione quando l'input coincide coi `params`; test di uguaglianza per kind (T17) |
| Scope ampio | Tappe con stop (G-2), task atomici, gate per task |

## 12. Contratto API (server → FE)

Richieste in camelCase (tranne i campi anagrafici del PATCH, che restano i nomi di colonna come oggi), risposte con i
nomi delle colonne, errori `{error, code?, …}` (AGENTS). `PersonRef` = `{id, full_name, headline, title, company_name,
linkedin_url, email, status, first_source: {kind, captured_at, label} | null, next_action_on, next_action_text,
manual_met_on}` (pannelli doppioni: *"Marco Riva — Head of Engineering · Beta (commento del 2 set)"*, e i riepiloghi di
C9: *"Ha già una prossima azione (25 set · Richiamare)…"*, *"Ha già la fonte 'Aggiunta a mano' (5 giu)…"*).
**Ordine delle route**: le path statiche sotto `/prospects/` (`duplicates`, `view-counts`, `ids`, `bulk/…`) si
registrano prima di `/prospects/:id` (che risponde 404 su un id non numerico): `peopleRoutes` si monta **prima** di
`prospectsRoutes` in `app.ts`, e `view-counts` sta sopra `/:id` in `prospects.ts`.

| Metodo e path | Task | Esito |
|---|---|---|
| `PATCH /api/prospects/:id` (+ `linkedin_url`, `confirm_email_duplicate?`) | T3, T7 | 200 dettaglio (con `manual_fields`) · 400 `contact_required` (E4) · 400 `linkedin_required` (E3, svuotare) · 409 `linkedin_locked` (E3, fonti dei job) · 409 `linkedin_taken` `{prospect: PersonRef, mergeable, reason?}` · 409 `email_taken` `{prospects: PersonRef[]}` · 400 `invalid_linkedin` / `invalid_email`. Marca `manual_fields` per ogni campo presente nel body |
| `PUT /api/prospects/:id/company {companyId}` · `DELETE /api/prospects/:id/company` | T3 | 200 dettaglio · 404 persona · 404 `company_not_found` ("Azienda non trovata: forse è stata unita a un'altra."); Scollega conserva il nome come testo |
| `PUT /api/prospects/:id/next-action {on, text?, expectedSetAt?}` · `DELETE …/next-action {expectedSetAt?}` | T3 (+ `expectedSetAt` T23) | 200 dettaglio · 400 `next_action_date_required` ("Scegli la data della prossima azione.") · 409 `next_action_changed` |
| `GET /api/prospects/duplicates?linkedinUrl&email&name&excludeId` | T5 | `{linkedin: PersonRef \| null, email: PersonRef[], name: PersonRef[]}` (name = senza LinkedIn/email in comune, confronto senza maiuscole né spazi) |
| `POST /api/prospects` `{fullName, title?, companyId? \| companyName?, linkedinUrl?, email?, phone?, location?, meeting?: {context?, metOn}, listId?, status?, nextAction?: {on, text?}, createAnyway?}` | T5 | 201 dettaglio · 400 `{issues[]}` per campo · 409 `linkedin_taken` · 409 `email_taken` · 400 `list_archived` · 404 `company_not_found` |
| `POST /api/prospects/:id/meetings {context?, metOn, listId?, nextAction?}` | T5 | 200 `{prospect, replaced_next_action, source_created}` (C9) · 404 `prospect_not_found` · 400 `list_archived` |
| `GET /api/prospects/:id/merge-preview?otherId&patch=<json>` · `POST /api/prospects/:id/merge {otherId, patch?}` | T7 (+ fit T19) | anteprima `{moving: {sources, lists, activities, analyses}, linkedin, filled[], conflicts: [{field, keep, lose}], mergeable, reason}` · 200 dettaglio · 409 `not_mergeable` · 404 `other_not_found` |
| `GET /api/prospects?view&q&status&listId&list=none&source&postId&companyId&icpId&fit&next&contact&sort&page&today` | T8 (+ fit T19) | `{items, total, page, pageSize}`; righe con `next_action_on/text/set_at`, `next_action_state`, `created_at`, `manual_fields`, `fit_state`/`fit_origin` (T19) |
| `GET /api/prospects/view-counts?<stessi filtri>` · `GET /api/prospects/ids?view…` · `GET /api/inbox…` (alias) | T8 | `{tutte, da_smistare, con_prossima_azione, scartate}` · selezione "tutte le filtrate" |
| `GET /api/jobs/:id/retry-preview` | T17 (+ T35) | preview del kind con gli stessi `params` (+ blocker job in corso) · 409 `job_not_failed` · 409 `not_retryable` (analisi singola) · 404 |
| `PUT /api/prospects/:id/fits/:icpId {fit, reason?}` · `DELETE …/fits/:icpId` · `GET /api/icps/:id` (+ `manual_fits_count`) | T19 | 200 `{fit_state, fit_origin, manual_fit}` + attività `fit_change` · 404 |
| `GET /api/search?q` | T21 | `{people: [≤5], people_total, companies: [≤5], companies_total}`; `q` < 2 caratteri → liste vuote |
| `POST …/next-action/done {expectedSetAt}` · `POST /api/prospects/:id/touchpoints` (+ `nextAction?`) | T23 | 200 dettaglio + attività `next_action_done` · 409 `next_action_changed` · touchpoint come oggi + prossima azione nello stesso passo (G2) |
| `GET /api/today?today` | T25 (+ T34) | `{empty, due[], upcoming[], to_triage, recent[10], setup_missing[], failed_runs[]}` |
| `GET /api/runs/:id/log?after` | T28 | `{lines: [{seq, at, level, message}], omitted, logged, state}` · 404 "Run non trovato." |
| `GET /api/connections` · `GET /api/connections/:tool/runs?outcome&page` · `GET /api/runs/:id` | T30 | strumenti `{tool, label, enables, env_var, configured, runs_count, last_run, health}` · run `{…job, tools, outcome, failed_tools, detached}` · 404 "Strumento non trovato." / "Run non trovato." |

## 13. Backlog (story product-facing, `relation_mode: body-links`, nessun tracker esterno)

| Story | Titolo | Criteri SPEC | Task |
|---|---|---|---|
| PF-S1 | Navigazione centrata su Persone e Aziende | A1–A7 | T10, T15, T22, T26, T31 |
| PF-S2 | Persone: tutte le persone, viste e filtri | B1–B10 | T8, T11, T21 (perf) |
| PF-S3 | Aggiungere una persona a mano (eventi) | C1–C11 | T5, T9, T12 |
| PF-S4 | Persona ↔ azienda e dati impostati a mano | D1–D9 | T3, T4, T13 |
| PF-S5 | Identità senza LinkedIn e Unisci | E1–E12 | T4, T5, T6, T7, T14 |
| PF-S6 | Il mio fit per ICP | F1–F10 | T19, T20 |
| PF-S7 | Prossima azione | G1–G6 | T3, T5, T13, T23, T24 |
| PF-S8 | Oggi | H1–H8 | T15, T25, T26, T34 |
| PF-S9 | Ricerca globale | I1–I5 | T21, T22 |
| PF-S10 | Connessioni, run, log e "Riprova" | J1–J15 | T17, T18, T28–T35 |
| PF-S11 | Coerenza, migrazione reale, documenti | K1–K5, Constraints | T0, T1, T2, T9, T16, T27, T36 |

## 14. Task

`backlog_item_url` punta (wikilink per titolo di sezione) alla sezione della SPEC che fa da story (`relation_mode: body-links`).

### M1 — Persone e contatti manuali

### T0: Base git e baseline

- **depends_on**: []
- **location**: git; `brain/specs/prospect-crm/people-first-crm/`
- **description**: `git fetch origin main:main` (fast-forward del `main` locale a `0967f2f` senza cambiarne il
  checkout), poi `git switch -c people-first-crm origin/main`: l'albero di `HEAD` (`14897c5`) coincide con `0967f2f`,
  quindi le modifiche non committate del brain passano sul branch. **Non** usare `git checkout main`: fallisce su
  `prospect-crm-specs.md` modificato, e un `checkout -f` cancellerebbe le modifiche del brain. Se
  `pgrep -f "src/server/index.ts|job-entry"` trova processi del CRM, fermarli come dice §5 (per PID, mai durante un
  job) e ricontrollare prima di T1. Eseguire i 4 gate e
  annotarne l'esito come baseline. Proporre all'utente il primo commit (SPEC, FLOW, PLAN, bookkeeping del brain) e
  farlo **solo** con il suo via (AGENTS: commit solo su richiesta).
- **validation**: `git rev-parse main` = `0967f2f…`; `git branch --show-current` = `people-first-crm`; `pgrep` senza
  processi del CRM; 4 gate verdi annotati nel log.
- **status**: Done
- **log**: 2026-09-18: `git fetch origin main:main` (7a33339..0967f2f), `git switch -c people-first-crm origin/main` (upstream tolto: il branch non traccia `main`), modifiche del brain passate sul branch; `pgrep`/`lsof` senza processi del CRM sul DB reale (server già fermato dall'agente lo stesso giorno). Baseline: typecheck ✓, `npm test` 37 file/520 test ✓, web build ✓, web typecheck ✓. Primo commit proposto allo stop di M1 (nessun commit senza via dell'utente).
- **files edited/created**: nessun file di codice
- **backlog_item_id**: PF-S11
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#Constraints]]
- **relation_mode**: body-links
- **tdd_target**: n/a (task di preparazione, non TDD): verifica = i 4 gate verdi sul branch nuovo prima di qualunque
  modifica al codice.
- **review_mode**: cli

### T1: Schema e migrazione unica

- **depends_on**: [T0]
- **location**: `src/db/schema.ts`, `tests/schema.test.ts`, `tests/fixtures/schema-apollo-lookalike.sql`
- **description**: (1) Prima di cambiare lo schema, salvare in `tests/fixtures/schema-apollo-lookalike.sql` la DDL di
  un DB nuovo creato con lo `SCHEMA` attuale (`0967f2f`). (2) Nuovo schema di §6: `PROSPECTS_TABLE` +
  `PROSPECTS_INDEXES` esportati (come `COMPANIES_TABLE`), `ACTIVITY_KINDS` + `fit_change`, `next_action_done`,
  `JOBS_TABLE` con `detached`/`logged`/`tools` in coda, tabelle `manual_fits` e `run_logs`, indici nuovi.
  (3) `planSchemaMigration` + `prospects` (ricostruzione se `linkedin_url` ha `notnull = 1`), `activities`
  (`enumCheckOutdated`), `jobsColumns`; `migrateSchema` ricostruisce con `presentColumns`, fa gli `ALTER` e il
  backfill di `tools`, nella stessa transazione e con un solo backup. Il resto del codice non cambia in questo task.
- **validation**: vitest: (a) DB creato da `schema-apollo-lookalike.sql` con dati sintetici (persone con fonti, liste,
  attività, analisi; job storici di ogni kind, anche `analyze` con `enriched_first > 0`) → migrato con gli stessi
  conteggi per **ogni** tabella, `linkedin_url` nullable, `manual_fields = '{}'`, `tools` per kind, `foreign_key_check`
  vuoto, **un** backup; (b) secondo `applySchema` = no-op senza backup; (c) DB nuovo = stesso schema del DB migrato
  (confronto normalizzato di `sqlite_master`); (d) un DB `schema-crm-foundation.sql` migra fino in fondo; (e) con un
  pid di job vivo la migrazione rifiuta senza modifiche; (f) vincoli: persona senza recapiti rifiutata, con sola email
  accettata, due URL uguali rifiutati, due URL nulli accettati, `next_action_on = '2026-13-40'` rifiutata, testo della
  prossima azione senza data rifiutato.
- **status**: Done
- **log**: 2026-09-18: fixture `schema-apollo-lookalike.sql` = `SCHEMA` di 0967f2f con gli enum risolti. Nuovi `PROSPECTS_TABLE`/`PROSPECTS_INDEXES`, `ACTIVITIES_TABLE`/`ACTIVITIES_INDEXES`, `JOBS_NEW_COLUMNS` (stessa DDL per `JOBS_TABLE` e per gli ALTER), `manual_fits`, `run_logs`. Piano `{companies, sources, jobs, prospects, activities, jobsColumns}` (`prospectsColumns` di apollo-lookalike assorbito dalla ricostruzione di `prospects`, che copia anche le colonne Apollo se ci sono); backfill `tools` con `legacyRunTools` (pura, in `schema.ts` per l'isolamento di T2). Deviazione: CHECK della data `date(x) IS x` invece di `= x` (con `=` una data invalida dà NULL e il CHECK passerebbe). Test: 5 nuovi (migrazione con dati su ogni tabella, no-op, DDL nuovo = migrato anche da crm-foundation, job vivo, vincoli) + aggiornati quelli di apollo-lookalike alla forma nuova del piano; `npm test` 525 ✓.
- **files edited/created**: `src/db/schema.ts`, `tests/schema.test.ts`, `tests/fixtures/schema-apollo-lookalike.sql` (nuovo)
- **backlog_item_id**: PF-S11
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#Data model (delta, livello di dominio)]]
- **relation_mode**: body-links
- **tdd_target**: Un DB con lo schema di apollo-lookalike e dati viene migrato: stessi conteggi per tabella, una persona
  con sola email si inserisce, una senza recapiti no.
- **review_mode**: cli

### T2: Verifica della migrazione sulla copia del DB reale

- **depends_on**: [T1]
- **location**: `scripts/migration-check.ts`, `package.json` (script `db:migration-check`),
  `tests/migration-check.test.ts`
- **description**: **Isolamento dal DB reale** (il rischio è migrare `data/crm.db` in posto): lo script **non importa
  mai** `src/db/index.ts` né moduli che lo importano (`db/prospects.ts`, `db/lists.ts`, …): usa solo `better-sqlite3` e
  `src/db/schema.ts` (che importa solo `jobs/types`, `util/fields`, `util/process`), con import **dinamici** dopo aver
  fissato `DB_PATH`: se quello ereditato punta fuori da `data/` e dal repo lo tiene (così il test può passare la sua
  sentinella), altrimenti lo imposta su una sentinella in `os.tmpdir()`; tutti i conteggi sono SQL crudo sulla
  connessione della copia. **Il sorgente non si apre mai con SQLite**: anche un'apertura `readonly` di un DB in WAL crea
  `-wal`/`-shm` accanto al file (riprodotto al gate). Sul DB reale quasi tutti i dati stanno nel `-wal` (il server non fa
  checkpoint all'uscita: `crm.db` 4 KB, `crm.db-wal` 2,9 MB al 2026-09-18), quindi un `-wal` non vuoto è lo stato normale,
  non un segnale di server acceso. `checkMigration(srcPath, {tmpDir})`: **preflight sui processi** (rifiuta se è vivo un
  processo che ha aperto il DB reale: `lsof <src> <src>-wal`, più preciso di `pgrep`, che vedrebbe anche i figli dei
  server e2e), poi copia byte per byte **la coppia** `<src>` e
  `<src>-wal` (se esiste; mai `-shm`, mai il solo `.db` quando c'è un `-wal`: i conteggi risulterebbero vuoti prima e
  dopo e la prova passerebbe per falso) in `<tmp>/copy.db` e `<tmp>/copy.db-wal` in `os.tmpdir()` (rifiuta `tmpDir`
  dentro `data/` o dentro il repo), apre **solo la copia** (SQLite riapplica il WAL nella copia), verifica
  `integrity_check`, rifiuta se nella copia c'è un job `running` con pid vivo, misura prima: righe per tabella, colonne per tabella (`PRAGMA table_info`), persone
  "Inbox" (senza liste, non scartate), persone visibili per azienda (collegate o con fonte sull'azienda), righe con
  `linkedin_url` vuoto; esegue `migrateSchema` + `SCHEMA` sulla copia; misura dopo: righe per tabella, colonne (tutte
  le vecchie ancora presenti), Da smistare, persone collegate per azienda; `foreign_key_check`; secondo passaggio
  no-op; cancella copia e `.bak-*`. Stampa un report di **soli numeri** (nessun nome, nessun dato personale). L'agente
  lo esegue una volta, dopo aver verificato con `pgrep` che il server reale è fermo (T0):
  `npm run db:migration-check -- data/crm.db`, annotando prima e dopo dimensione e mtime di `data/crm.db`, `-wal` e
  `-shm` (devono coincidere). **Mai** "sistemare" il WAL lanciando comandi che importano `src/db/index.ts` (migrerebbero
  `data/crm.db` in posto, contro G-5), e riporta i numeri nel log. Se un conteggio o una colonna
  differisce, se ci sono violazioni FK, URL vuoti o file reali cambiati: **stop** e domanda all'utente prima di
  proseguire M1.
- **validation**: vitest su due fixture: (1) DB in WAL chiuso pulito; (2) **layout reale**: DB in WAL scritto da un
  processo terminato con SIGINT senza checkpoint (dati nel `-wal`, `.db` quasi vuoto). Per entrambe: conteggi (non
  nulli nella (2)) e colonne uguali, `secondRunNoop: true`, `fkViolations: []`, file temporanei rimossi, cartella del
  sorgente con gli **stessi file** e stessi dimensione e mtime di `.db` e `-wal`; rifiuta con un processo che ha il DB
  aperto (preflight iniettabile nel test); rifiuta `tmpDir` sotto `data/`; un
  test **lancia lo script come processo** passando `DB_PATH` su una sentinella in `os.tmpdir()` e verifica che la
  sentinella non venga mai creata (nessun import di `db/index.ts`), con il preflight disattivato da una variabile
  d'ambiente accettata solo se il sorgente sta in `os.tmpdir()`, e con exit code 0 (così un server acceso durante
  `npm test` non fa uscire lo script prima degli import). Esecuzione reale nel log: file reali invariati, Inbox prima = Da smistare dopo (non esistono ancora
  fonti manuali), numero di aziende con meno persone visibili dopo D5.
- **status**: Done
- **log**: 2026-09-18: `scripts/migration-check.ts` (`checkMigration`, `pinSafeDbPath`, `openersOf` con `lsof -t`), script `db:migration-check`; 6 test (WAL chiuso pulito, layout reale con scrittore terminato da SIGINT, il solo `.db` senza tabelle, rifiuto con DB aperto, rifiuto di `tmpDir` in `data/` o nel repo senza crearla, processo con sentinella `DB_PATH` mai creata ed exit 0). **Esecuzione reale** (`pgrep`/`lsof` vuoti prima): `crm.db` 4096 B, `-wal` 2.892.272 B, `-shm` 32.768 B con le stesse dimensioni e mtime prima e dopo; `integrity_check` ok; tabelle migrate sulla copia: companies, sources, jobs, prospects, activities (**il DB reale è ancora allo schema di crm-foundation**: il primo avvio dopo M1 farà anche la migrazione di apollo-lookalike, con un solo backup); righe uguali per ogni tabella (prospects 67, sources 77, activities 85, analyses 12, list_members 7, jobs 3, companies 1, posts 9, …); nessuna colonna persa; FK 0; URL vuoti 0; Inbox prima 0 = Da smistare dopo 0; aziende che si accorciano con D5: 0; secondo giro no-op; copia rimossa.
- **files edited/created**: `scripts/migration-check.ts` (nuovo), `tests/migration-check.test.ts` (nuovo), `package.json`
- **backlog_item_id**: PF-S11
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#Constraints]]
- **relation_mode**: body-links
- **tdd_target**: `checkMigration(copiaFixture)` riporta conteggi uguali per ogni tabella, `secondRunNoop: true` e
  lascia intatto il file sorgente.
- **review_mode**: cli

### T3: Scritture manuali: anagrafica "a mano", azienda, prossima azione (API)

- **depends_on**: [T1]
- **location**: `src/db/manual-fields.ts` (nuovo), `src/db/prospects.ts`, `src/db/people.ts` (nuovo),
  `src/db/next-actions.ts` (nuovo), `src/server/routes/people.ts` (nuovo), `src/server/routes/next-actions.ts`
  (nuovo), `src/server/routes/prospects.ts`, `src/server/app.ts`, `tests/api-people-manual.test.ts`
- **description**: `markManual(id, cols)` scrive `manual_fields[col] = nowIso()`. Il PATCH marca ogni campo presente
  nel body, valorizzato o svuotato (D8), e rifiuta con 400 `contact_required` lo svuotamento di email e telefono su una
  persona senza LinkedIn (E4, *"Serve almeno un recapito: senza profilo LinkedIn tieni l'email o il telefono."*).
  `PUT/DELETE /api/prospects/:id/company` (D1–D4): collega, cambia, scollega (lo scollegamento conserva il nome come
  testo: `company_name = COALESCE(company_name, nome dell'azienda)`), marca `company_id`. Il filtro `companyId` di
  `buildQuery` diventa "solo collegate" (D5). `PUT/DELETE /api/prospects/:id/next-action` (G1, senza timeline; data
  obbligatoria; stato e liste invariati, G6). Dettaglio con `manual_fields` e prossima azione. Transazioni `.immediate()`.
  `peopleRoutes` e `nextActionsRoutes` si montano in `app.ts` **prima** di `prospectsRoutes` (ordine delle route, §12).
- **validation**: PATCH `title` → `manual_fields.title`; PATCH `email: ''` → email nulla e marcata; E4 → 400; PUT
  azienda → in `/api/prospects?companyId=`, mentre chi ha solo la fonte `company_employees` di quell'azienda non c'è;
  DELETE azienda → nome testuale conservato, `company_id` marcato; PUT con azienda inesistente o unita → 404
  `company_not_found`; prossima azione impostata/modificata/rimossa, testo senza data → 400
  `next_action_date_required`, data invalida → 400; nessun `status_change`.
- **status**: Done
- **log**: 2026-09-18: RED (7 test falliti) → GREEN. `manual-fields.ts` (`MANUAL_COLUMNS`, `parseManualFields`, `markManual` con `json_set`, `jobAssign` per T4); `people.ts` (`linkCompany`/`unlinkCompany`, `.immediate()`); `next-actions.ts` (`setNextAction`/`clearNextAction`); `isCalendarDate` in `util/fields.ts`; router `people` e `next-actions` montati prima di `prospects`; `requireProspect` esportato da `routes/prospects.ts`. PATCH: `updateProspect` → `'ok'|'not_found'|'contact_required'`, marca ogni campo presente. Filtro `companyId` = solo collegate (D5): aggiornata l'asserzione di `api-prospects.test.ts`. Scollega: `company_name = COALESCE(company_name, nome dell'azienda)`, marcato solo `company_id`. Gate: typecheck ✓, `npm test` 538 ✓.
- **files edited/created**: `src/db/manual-fields.ts`, `src/db/people.ts`, `src/db/next-actions.ts` (nuovi), `src/db/prospects.ts`, `src/util/fields.ts`, `src/server/routes/people.ts`, `src/server/routes/next-actions.ts` (nuovi), `src/server/routes/prospects.ts`, `src/server/app.ts`, `tests/api-people-manual.test.ts` (nuovo), `tests/api-prospects.test.ts`
- **backlog_item_id**: PF-S4
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#D. Persona ↔ azienda]]
- **relation_mode**: body-links
- **tdd_target**: PUT azienda su una persona → compare in `GET /api/prospects?companyId=<id>`, mentre una persona con la
  sola fonte `company_employees` di quell'azienda non compare; `manual_fields.company_id` valorizzato.
- **review_mode**: cli

### T4: I job rispettano i dati a mano

- **depends_on**: [T3]
- **location**: `src/db/manual-fields.ts`, `src/db/prospects.ts` (`upsertProspect`), `src/jobs/enrich.ts`
  (`applyEnrichment`, `planEnrichment`), `src/enrich/apollo-match.ts`, `src/db/identity.ts` (`nameTwin`,
  `mergeProspects`), `src/db/person-merge.ts` (nuovo: nucleo + regola automatica), `src/server/routes/enrich.ts`,
  `tests/manual-data-jobs.test.ts` (+ aggiornamenti a `enrich-prospects`, `enrich-apollo`, `prospect-identity`,
  `source-company`, `apollo-people`)
- **description**: ogni scrittore di §1 usa `jobAssign` (D7, D8: niente sovrascrittura né riempimento dei campi
  marcati, anche con `refresh`); `nameTwin` ignora le righe senza `linkedin_url` (E1); `mergeProspects` delega a
  `person-merge.ts` con la regola automatica E9: per ogni colonna marcata su almeno una delle due vince il valore del
  lato marcato più di recente (anche se svuotato) e la marca resta; prossima azione con `next_action_set_at` più
  recente; stato come oggi. E10 è coperto da `upsertProspect` con la stessa regola. D9: la preview dell'arricchimento
  `provider: 'apollo'` esclude e conta a parte (`email_cleared`) chi ha l'email svuotata a mano, warning *"N con email
  svuotata a mano: escluse"*.
- **validation**: un test per scrittore: arricchimento Apify con nome/ruolo/email nuovi → campi marcati invariati,
  headline mai toccata aggiornata, email svuotata non riempita; `source_company` con `refresh` non cambia un
  `company_id` né un ruolo marcati; `apollo_people` idem; match Apollo non riempie un'email svuotata; conteggio D9 in
  preview; unione automatica (id membro rivelato da un upsert) che conserva il ruolo marcato più recente dell'assorbita
  e la prossima azione più recente; `nameTwin` non aggancia una reazione a una persona manuale senza LinkedIn con stesso
  nome e headline; E10: una reazione con l'URL di una persona manuale le aggiunge la fonte senza creare una persona.
  Checklist `rg "UPDATE prospects|upsertProspect\("` nel log.
- **status**: Done
- **log**: 2026-09-18: `jobAssign` in `upsertProspect` (backfill e `refresh`, colonne di `MANUAL_COLUMNS`), `applyEnrichment` (anche email/telefono/`company_id`), `applyApolloMatch` (email, ruolo, azienda testuale). `person-merge.ts`: `readPerson`, `autoMergedValues` (E9: per colonna marcata vince il lato marcato più di recente, anche vuoto; marche unite con la data più recente; prossima azione con `next_action_set_at` più recente; stato dal cambio più recente; `defaultLinkedin` robusto con URL nulli), `applyMerge` (nucleo condiviso con T7), `mergePeopleAuto`; `mergeProspects` delega. `nameTwin` esclude `linkedin_url IS NULL`. D9: `EnrichPlan.email_cleared`, conteggio e warning *"N con email svuotata a mano: escluse."* nella preview Apollo, chiave `email_cleared` nei conteggi del job Apollo (test di apollo-lookalike aggiornati). Checklist `rg "UPDATE prospects|upsertProspect\\("`: scrittori dei job = `upsertProspect` (sync, source_company, apollo_people, fake e2e), `applyEnrichment`, `applyApolloMatch`, `mergeProspects`; gli altri `UPDATE` toccano stato, prossima azione, chiavi (identity), `apollo_person_id`/`apollo_matched_at`, `company_id` dell'unione di aziende (stessa azienda, P-3) o sono scritture manuali. Test: 9 (uno per scrittore + E9 + nameTwin + E10 + D9); gate: typecheck ✓, `npm test` 547 ✓.
- **files edited/created**: `src/db/manual-fields.ts`, `src/db/person-merge.ts` (nuovo), `src/db/identity.ts`, `src/db/prospects.ts`, `src/jobs/enrich.ts`, `src/enrich/apollo-match.ts`, `src/server/routes/enrich.ts`, `tests/manual-data-jobs.test.ts` (nuovo), `tests/enrich-apollo.test.ts`
- **backlog_item_id**: PF-S4
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#D. Persona ↔ azienda]]
- **relation_mode**: body-links
- **tdd_target**: Una persona con ruolo impostato a mano ed email svuotata a mano: l'arricchimento (deps finte) con
  ruolo ed email nuovi li lascia come sono e aggiorna la headline mai toccata.
- **review_mode**: cli

### T5: Aggiungi persona: creazione, doppioni, incontro (API)

- **depends_on**: [T3]
- **location**: `src/db/people.ts`, `src/db/activities.ts`, `src/db/prospects.ts` (tipi: `linkedin_url: string |
  null`), `src/server/routes/people.ts`, `src/util/fields.ts`, consumatori segnalati da `npm run typecheck`,
  `tests/api-people-create.test.ts`
- **description**: endpoint di §12. Validazioni con `issues[]` per campo: nome (*"Inserisci il nome."*), almeno un
  recapito (*"Serve almeno un recapito: profilo LinkedIn, email o telefono."*), URL di un profilo persona (`/in/…`,
  *"Non è il profilo di una persona: usa un URL del tipo https://www.linkedin.com/in/nome-cognome/"*), email (*"Email
  non valida (es. nome@azienda.it)."*), testo della prossima azione senza data. LinkedIn già presente (anche in altra
  forma, e anche per corsa sull'indice unico) → 409 `linkedin_taken` con `PersonRef`; email già presente (senza
  maiuscole, trim) → 409 `email_taken` salvo `createAnyway`; lista archiviata → 400 `list_archived` (*"La lista 'X' è
  archiviata: scegline un'altra."*); azienda sparita → 404 `company_not_found`. Creazione in una transazione
  `.immediate()`: persona con **tutti** i campi scritti e l'eventuale `company_id` marcati a mano, fonte `manual` con
  `captured_at` = ora dell'inserimento e `raw_json {met_on}` (data dell'incontro, default oggi, P-4), nota del contesto con
  `meta.meeting` (P-5), `status_change` se lo stato iniziale non è Nuovo (C6, K1), membership, prossima azione. Nessun
  job, nessuna chiamata esterna (C11). `meetings` (C9): persona sparita → 404 `prospect_not_found` (*"… non è più nel
  CRM (forse unito a un'altra persona)…"*); fonte `manual` solo se manca (altrimenti resta con il suo `met_on`), sempre la
  nota, lista, prossima azione sostituita (`replaced_next_action`), `created_at` invariato (H4), risposta con `status`
  (per l'avviso "scartato"). `duplicates` come in §12. `SourceView`/`loadSources` espongono `met_on` (`json_extract(s.raw_json, '$.met_on')`) per
  le fonti `manual`: Fonti (C5), tooltip *"Aggiunta a mano · incontro del 12 set"* (FLOW B.4) e C9 lo mostrano al posto di
  `captured_at`. Il cambio di tipo di `linkedin_url` si chiude con guardie
  esplicite nei consumatori (T6 le rende comportamento).
- **validation**: creazione con nome + email (201, fonte con `met_on`, nota datata, URL nullo, nessuna riga `jobs`); ogni errore di
  C3; C7 anche con URL in forma diversa (slash finale, `http`, id membro); C8 → 409 poi `createAnyway` → 201; stato
  `contattato` → `status_change`; lista archiviata; `meetings` su persona esistente (fonte conservata, seconda nota,
  lista, `replaced_next_action: true`) e su id sparito (404); `duplicates` per nome esclude chi ha LinkedIn o email in
  comune.
- **status**: Done
- **log**: 2026-09-18: RED → GREEN (11 test). `people.ts`: `PersonRef` + `personRefs` (azienda collegata o testo, prima fonte con `label` in italiano senza data — la data la formatta la FE — e `met_on` per la manuale, `manual_met_on`), `personByLinkedin`/`peopleByEmail`/`peopleByName` (nome confrontato in JS: `lower()` di SQLite non abbassa le lettere accentate), `findDuplicates`, `createPerson` (validazione con `issues[]` per campo, poi lista/azienda, LinkedIn → 409, email → 409 salvo `createAnyway`, transazione `.immediate()`; corsa sull'indice unico → `linkedin_taken`), `addMeeting`. `identity.ts`: `findByLinkedinKeys`. `util/fields.ts`: `localDate`, `isEmailLike`. `SourceView.met_on`; `linkedin_url: string | null` in `ProspectBase` (nessun errore di tipo: i job leggono le righe con tipi propri, le guardie comportamentali sono in T6). Nessuna nota se il contesto è vuoto (C5 la chiede solo se compilato). Gate: typecheck ✓, `npm test` 558 ✓.
- **files edited/created**: `src/db/people.ts`, `src/db/identity.ts`, `src/db/prospects.ts`, `src/util/fields.ts`, `src/server/routes/people.ts`, `tests/api-people-create.test.ts` (nuovo)
- **backlog_item_id**: PF-S3
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#C. Aggiungere una persona a mano]]
- **relation_mode**: body-links
- **tdd_target**: POST `/api/prospects` con nome e sola email → 201: `linkedin_url` nullo, fonte `manual` con `met_on`
  uguale alla data dell'incontro, nota con il contesto datata a quella data; lo stesso POST con un URL LinkedIn già presente → 409 `linkedin_taken` con
  la persona esistente.
- **review_mode**: cli

### T6: Persone senza LinkedIn nei job e nell'export

- **depends_on**: [T5]
- **location**: `src/jobs/enrich.ts`, `src/jobs/analyze.ts`, `src/analysis/analyze.ts`, `src/server/routes/enrich.ts`,
  `src/server/routes/analyze.ts`, `src/exports/list-export.ts`, test di `enrich-prospects`, `analyze`, `list-export`
- **description**: E11: `planEnrichment` e `planAnalysis` escludono le persone senza LinkedIn e le contano in
  `counts.no_linkedin` (fuori da stima e spesa, warning *"N senza LinkedIn: escluse"*), su selezione e su lista; i job
  non passano mai un URL nullo alle deps; arricchimento e analisi singoli su una persona senza LinkedIn → 409
  `no_linkedin` (*"Serve il profilo LinkedIn: aggiungilo per arricchire o analizzare questa persona."*). E12: il CSV
  include la persona con la colonna LinkedIn vuota.
- **validation**: preview di arricchimento e di analisi (selezione e lista) con una persona senza LinkedIn; job reali
  in-process con deps finte che falliscono se ricevono un URL nullo; 409 sui singoli; riga CSV.
- **status**: Done
- **log**: 2026-09-18: `planEnrichment` (entrambi i provider) e `planAnalysis` escludono chi non ha LinkedIn e lo contano in `no_linkedin` (resta in `selected`); preview con `counts.no_linkedin` e warning *"N senza LinkedIn: escluse."*; conteggi dei job (`EnrichCounts`, `ApolloEnrichCounts`, `AnalyzeCounts`) con `no_linkedin` e riassunto *"N senza LinkedIn (escluse)"*. Guardie: `enrichOne` non chiama il provider con URL nullo (errore `NO_LINKEDIN_ERROR`), il lotto Apollo salta le righe senza id Apollo né URL. `POST /prospects/:id/enrich` e `/analyze` → 409 `no_linkedin`. CSV: la colonna vuota c'era già (`csv.ts` rende null come vuoto), ora coperta da test. Tipi `linkedin_url: string | null` in `AnalysisSubject`, `ProspectKeyRow`, `MatchTargetRow`. Test: 7 nuovi (`no-linkedin.test.ts`, deps finte che falliscono su URL nullo) + chiave `no_linkedin` nelle asserzioni esatte di analyze/enrich-apollo/enrich-prospects. Gate: typecheck ✓, `npm test` 565 ✓.
- **files edited/created**: `src/jobs/enrich.ts`, `src/jobs/analyze.ts`, `src/db/analyses.ts`, `src/server/routes/enrich.ts`, `src/server/routes/analyze.ts`, `tests/no-linkedin.test.ts` (nuovo), `tests/analyze.test.ts`, `tests/enrich-apollo.test.ts`, `tests/enrich-prospects.test.ts`
- **backlog_item_id**: PF-S5
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#E. Identità delle persone]]
- **relation_mode**: body-links
- **tdd_target**: Preview di arricchimento su una selezione con una persona senza LinkedIn → `counts.no_linkedin = 1`,
  fuori da `to_enrich` e dalla stima.
- **review_mode**: cli

### T7: Modifiche d'identità e Unisci (API)

- **depends_on**: [T4, T5]
- **location**: `src/db/prospects.ts` (`updateProspect`), `src/db/person-merge.ts` (regola manuale, anteprima),
  `src/server/routes/prospects.ts` (schema del PATCH), `src/server/routes/people.ts`,
  `tests/api-people-identity.test.ts`
- **description**: E3: `linkedin_url` nel PATCH si aggiunge se manca; si cambia solo se la persona ha soltanto fonti
  `manual` (altrimenti 409 `linkedin_locked`); svuotarlo → 400 `linkedin_required` (*"Il profilo LinkedIn non si può
  rimuovere."*); normalizzato con `identityKeys` (la forma id membro va in `member_urn`). E5, solo se il valore cambia:
  URL di un'altra persona → 409 `linkedin_taken` `{prospect, mergeable, reason}` (`mergeable: false` se le due persone
  hanno URL o id membro diversi, E7); email di altre persone → 409 `email_taken` salvo `confirm_email_duplicate`.
  Anteprima e unione manuale: resta `:id`; i valori della `patch` contano come suoi (E6); E7 nel caso LinkedIn: URL che
  si stava salvando + id membro dell'altra; altrimenti il profilo di chi lo ha; profili distinti → 409 `not_mergeable`;
  spostamento di fonti, liste, attività, analisi e prossima azione (solo se manca), `manual_fields` in unione; nessun
  `status_change` (E8); altra persona sparita → 404 `other_not_found`.
- **validation**: tdd target + varianti di E3 (aggiunta libera, correzione con sola fonte manuale, blocco con fonti dei
  job, svuotamento), E5 email con "Salva comunque", E7 rifiuto con motivo, E7 "altri casi": unione nata da un
  conflitto d'email in cui la persona tenuta **non** ha LinkedIn e l'altra sì → la tenuta prende URL e `member_urn`
  dell'altra (il nucleo non riusa la scelta dell'URL di `identity.ts:162`, che con un URL nullo lo perderebbe),
  anteprima con `conflicts` e `filled`, E8 (GET dell'assorbita → 404 *"Persona non trovata."*, timeline con i cambi di
  stato di entrambe).
- **status**: Done
- **log**: 2026-09-18: RED → GREEN (7 test). `people.ts`: `editPerson` (PATCH: LinkedIn aggiunto se manca, corretto solo senza fonti dei job → 409 `linkedin_locked`, svuotato → 400 `linkedin_required`, non profilo → 400 `invalid_linkedin`; URL di un'altra persona → 409 `linkedin_taken` `{prospect, mergeable, reason}`; email di altri → 409 `email_taken` salvo `confirm_email_duplicate`, confronto senza maiuscole/spazi e solo se cambia; email malformata → 400 `invalid_email`; E4 sul risultato finale prima di scrivere), `profileKeysOf`. `person-merge.ts`: `notMergeableReason` (E7: nel caso LinkedIn conta solo l'id membro), `manualMergeCheck` (patch come valori della tenuta e marcata a mano; profilo `patch`/`keep`/`other`), `mergePreview` (`moving`, `linkedin`, `filled`, `conflicts` con azienda per nome, stato, prossima azione), `mergePeopleManual` (`.immediate()`, nessun `status_change`). Route: `GET /prospects/:id/merge-preview?otherId&patch=<json>`, `POST /prospects/:id/merge {otherId, patch?}` (404 `other_not_found`, 409 `not_mergeable`); PATCH in `routes/prospects.ts` con `patchFields` condivisi. Aggiornata l'asserzione storica di `api-prospects.test.ts` (LinkedIn nel PATCH: prima 400 sempre, ora 409 con fonti dei job). Gate: typecheck ✓, `npm test` 572 ✓ (un giro con un fallimento instabile preesistente in `analyze.test.ts`, vedi IMPLEMENTATION-NOTES).
- **files edited/created**: `src/db/people.ts`, `src/db/person-merge.ts`, `src/server/routes/prospects.ts`, `src/server/routes/people.ts`, `tests/api-people-identity.test.ts` (nuovo), `tests/api-prospects.test.ts`
- **backlog_item_id**: PF-S5
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#E. Identità delle persone]]
- **relation_mode**: body-links
- **tdd_target**: A (solo email) e B (dai job, LinkedIn X): PATCH A con X → 409 `linkedin_taken` `mergeable: true`;
  merge con la patch → resta A con X e l'id membro di B, fonti di entrambe, stato di A senza nuovo `status_change`; GET
  B → 404.
- **review_mode**: cli

### T8: Persone: viste, filtri, ordinamenti, conteggi (API)

- **depends_on**: [T5]
- **location**: `src/db/prospects.ts` (`ProspectQuery`, `buildQuery`, `personTextCondition`, `hydrateRows`),
  `src/server/routes/prospects.ts`, `tests/api-people-list.test.ts` (+ aggiornamento dei test Inbox)
- **description**: `view` (`da_smistare` = senza liste, non scartate, **senza** fonte `manual`; `con_prossima_azione`;
  `scartate`; assente = Tutte senza scartate, B1–B3); filtri `list=none`, `status` multiplo, `next` (`scaduta` · `oggi`
  · `7g` · `nessuna`, con `today`), `contact` (`email` · `linkedin` · `no_linkedin`); `personTextCondition` = B5 (anche
  telefono, nome dell'azienda collegata e contesto dell'incontro, P-18); ordinamenti `added` (P-27), `name`,
  `next_action` (vicine prima, senza in fondo; default
  della vista Con prossima azione); `recent` invariato. Righe con prossima azione, `next_action_state`
  (scaduta/oggi/futura rispetto a `today`), `created_at`, `manual_fields`. `GET /prospects/view-counts` in una query
  aggregata con gli altri filtri; `/ids` con la vista; `/api/inbox` = alias della vista Da smistare.
- **validation**: tdd target + ogni filtro e ordinamento; `q=nuvola` trova una persona collegata a "Nuvola Srl" senza
  nome testuale dell'azienda; conteggio Scartate con lo stesso `q` (B6); `next` ai bordi di `today`; parametri non
  validi → 400 (i default li applica la FE).
- **status**: Done
- **log**: 2026-09-18: RED (6) → GREEN. `prospects.ts`: `PEOPLE_VIEWS` + `VIEW_CONDITIONS` (una sola definizione per filtro e conteggi), `NEXT_FILTERS` (con `today`, `addDays`), `CONTACT_FILTERS`, `list=none`, `personTextCondition` esportata (B5 = I2: + telefono, nome dell'azienda collegata, contesto dell'incontro), ordinamenti `added`/`name`/`next_action` (default nella vista Con prossima azione), `viewCounts` (una query aggregata, `view` ignorata), righe con `next_action_*`, `next_action_state`, `manual_fields`, `linked_company_name`. `inbox: true` = Da smistare (esclude la fonte manuale). **Decisione**: senza `view` nessun filtro di vista (lo usano Lista e Azienda, che mostrano anche le scartate); la FE di Persone manda sempre `view` (assente nell'URL = `tutte`). Route: schema query esteso, `GET /prospects/view-counts` prima di `/prospects/:id`; `calendarDate` spostato in `server/http.ts` (evita un ciclo d'import fra router). Aggiornate due asserzioni storiche di `api-prospects.test.ts` (Inbox senza la persona con fonte manuale). Gate: typecheck ✓, `npm test` 578 ✓.
- **files edited/created**: `src/db/prospects.ts`, `src/server/routes/prospects.ts`, `src/server/routes/next-actions.ts`, `src/server/http.ts`, `tests/api-people-list.test.ts` (nuovo), `tests/api-prospects.test.ts`
- **backlog_item_id**: PF-S2
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#B. Persone]]
- **relation_mode**: body-links
- **tdd_target**: Con una persona dai job senza liste, una aggiunta a mano senza liste e una scartata: `view=da_smistare`
  → solo la prima; `view-counts` → `{tutte: 2, da_smistare: 1, con_prossima_azione: 0, scartate: 1}`; `q=devfest` trova
  chi ha "DevFest" nel contesto dell'incontro.
- **review_mode**: cli

### T9: Seed e2e di M1 e trigger d'errore

- **depends_on**: [T5, T7, T8]
- **location**: `src/jobs/fake-deps.ts` (`seedE2eData`), `scripts/e2e-server.ts`, `tests/e2e-deps.test.ts`,
  `tests/e2e/README.md`
- **description**: il seed aggiunge: "Giulia Neri" aggiunta a mano con sola email e contesto "DevFest Milano" + una
  "Giulia Neri" arrivata dai job con LinkedIn (FLOW F); "Sara Conti" senza LinkedIn (C10); due persone con la stessa
  email (C8); una persona con prossima azione a **oggi + 10 giorni** (P-25; fuori dalle finestre di Oggi, così i
  conteggi di T26 restano fissi); ids nel risultato (`people: {…}`). Server e2e (P-23): app Hono esterna davanti a
  `createApp()` con `POST /api/e2e/fail-next {method, path, status?, times?}` (le prossime `times` richieste
  corrispondenti, path senza query string, rispondono 500 `{error: 'Errore interno (e2e).'}`; `reset` azzera le
  regole), usata per "Salvataggio fallito" e dai task successivi (`times` per riga, P-23). README: dataset,
  trigger, mappa FLOW → come ottenerlo.
- **validation**: vitest su `seedE2eData()`; prova con `curl` di `fail-next` su `POST /api/prospects` (500 una volta,
  poi 201) e con `times: 2` su una GET con query string (due 500, poi 200); README aggiornato.
- **status**: Done
- **log**: 2026-09-18: `seedPeople()` in `fake-deps.ts` (`E2ePeopleSeed`: due Giulia Neri, Sara Conti senza LinkedIn, Anna Bianchi + Ufficio Beta con `info@beta-e2e.example`, Marco Riva con prossima azione a oggi + 10, azienda Nuvola Srl); `E2eSeed.people`; Da smistare del seed 5 → 9 (asserzione storica aggiornata). `scripts/e2e-server.ts`: app Hono esterna (`outer`) con `POST /api/e2e/fail-next` (path senza query, `status`, `times`), reset/seed che azzerano le regole, il resto delegato a `createApp()` via `app.fetch`. Prova con `curl` su :8833 (fermato per PID): `POST /api/prospects` → 500 poi 201; `GET /api/prospects/view-counts?…` con `times: 2` → 500, 500, 200. README: endpoint, scenario, trigger 4 (`fail-next`) con la mappa delle righe d'errore. Gate: typecheck ✓, `npm test` 579 ✓.
- **files edited/created**: `src/jobs/fake-deps.ts`, `scripts/e2e-server.ts`, `tests/e2e-deps.test.ts`, `tests/e2e/README.md`
- **backlog_item_id**: PF-S11
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#Constraints]]
- **relation_mode**: body-links
- **tdd_target**: `seedE2eData()` restituisce `people.manual_email_only_id` e quella persona ha `linkedin_url` nullo ed è
  fuori da Da smistare.
- **review_mode**: cli

### T10: FE fondazione: client, sidebar, percorso, route e redirect

- **depends_on**: [T8, T9]
- **location**: `web/src/api/{types,client}.ts`, `web/src/routes/__root.tsx`, `web/src/components/Breadcrumbs.tsx`
  (nuovo), `web/src/lib/origin.ts` (nuovo), `web/src/routes/people.index.tsx` (da `inbox.tsx`, `git mv`),
  `web/src/routes/people.$id.tsx` (da `prospects.$id.tsx`, `git mv`), `web/src/routes/inbox.tsx` e
  `web/src/routes/prospects.$id.tsx` (solo redirect), `lists.$id.tsx`, `icps.$id.tsx`, `companies.$id.tsx` (percorso)
- **description**: tipi e client degli endpoint di M1; sidebar di P-22 (marchio "CRM personale" → `/`; gruppi
  **Contatti** con Persone + badge-link *"N persone da smistare"* → `/people?view=da_smistare` e Aziende, **Prospecting**
  con Liste e ICP, Impostazioni; `aria-current` sulla sezione anche nei dettagli, A6); percorso *"Persone › Mario
  Rossi"* ecc. in ogni dettaglio; redirect `replace` da `/inbox` (stessi parametri; `status` con `scartato` →
  `view=scartate` senza `status`, A4) e da `/prospects/$id` (A5); `from` (P-9) con link *"← <origine>"* (A7). Badge
  aggiornato dopo job e azioni che cambiano liste, stato o fonti. *"Persona non trovata"* + *"Il link potrebbe essere
  sbagliato, oppure la persona è stata unita a un'altra."* + **Vai a Persone**.
- **validation** (browser): `/inbox?source=post_comment&page=2` → `/people?view=da_smistare&source=post_comment&page=2`;
  `/inbox?status=scartato,nuovo&q=x` → `/people?view=scartate&q=x`; `/prospects/1?list=1` → `/people/1?list=1`;
  voce attiva e percorso su `/people/1`, `/lists/1`, `/companies/1`, `/icps/1`; `?from=/lists/1?page=2` mostra *"← <nome
  lista>"* anche dopo il reload; `?from=https://evil.example` e `?from=//evil.example` ignorati; badge = conteggio Da
  smistare; `/people/9999` → "Persona non trovata"; caricamento fallito della scheda (`fail-next` su
  `GET /api/prospects/1`) → ErrorBox + **Riprova** con la sidebar usabile (riga "Caricamento pagina fallito").
- **status**: Done
- **log**: 2026-09-18: tipi e client degli endpoint di M1 (`viewCounts`, `create`, `duplicates`, `addMeeting`, `linkCompany`/`unlinkCompany`, `setNextAction`/`clearNextAction`, `mergePreview`/`merge`; query key `viewCounts`, `toTriageCount` sotto il prefisso `prospects`). `git mv` inbox.tsx → people.index.tsx, prospects.$id.tsx → people.$id.tsx; `inbox.tsx`/`prospects.$id.tsx` = solo redirect in `beforeLoad`. Sidebar di P-22 (Contatti con badge-link, Prospecting, Impostazioni in fondo, marchio "CRM personale"). `Breadcrumbs` (percorso + "← origine", `activeOptions exact` perché TanStack mette `aria-current` sui link attivi in modo fuzzy) su persona, lista, azienda, ICP. `lib/origin.ts` (P-9, `defaultParseSearch`), `from` messo dai link della tabella. "Persona non trovata". Browser (e2e :8841 + Vite :5191): `/inbox?source=post_comment&page=2` → `/people?…&view=da_smistare` ✓; `/inbox?status=scartato,nuovo&q=x` → `?q=x&view=scartate` ✓; `/prospects/1?list=1` → `/people/1?list=1` ✓; percorso e voce attiva su persona/lista/azienda/ICP ✓; `from=/lists/1?page=2` → "Torna a CTO manifattura Nord Italia" (href con `page=2`) anche dopo reload ✓; `from` con `https://` o `//` ignorato ✓; badge 9 = Da smistare ✓; `/people/9999` → "Persona non trovata" ✓; `fail-next` su `GET /api/prospects/1` (`times: 2`) → ErrorBox + Riprova, poi la scheda ✓. Corretto `aria-current` anche su "Tutti gli ICP" (preesistente).
- **files edited/created**: `web/src/api/{types,client}.ts`, `web/src/routes/__root.tsx`, `web/src/components/Breadcrumbs.tsx` (nuovo), `web/src/lib/origin.ts` (nuovo), `web/src/routes/people.index.tsx` (da `inbox.tsx`), `web/src/routes/people.$id.tsx` (da `prospects.$id.tsx`), `web/src/routes/inbox.tsx`, `web/src/routes/prospects.$id.tsx` (redirect), `web/src/routes/{lists,icps,companies}.$id.tsx`, `web/src/routes/index.tsx`, `web/src/components/Timeline.tsx`, `web/src/lib/jobs.ts`
- **backlog_item_id**: PF-S1
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#A. Navigazione]]
- **relation_mode**: body-links
- **tdd_target**: `/inbox?source=post_comment&page=2` apre `/people?view=da_smistare&source=post_comment&page=2` con la
  voce Persone attiva e il badge uguale al conteggio Da smistare.
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T11: FE pagina Persone

- **depends_on**: [T10, T6]
- **location**: `web/src/routes/people.index.tsx`, `web/src/components/ProspectTable.tsx`,
  `web/src/components/filters/{FilterBar,FilterChips}.tsx`, `web/src/components/BulkBar.tsx`,
  `web/src/components/StatusSelect.tsx`, `web/src/lib/dates.ts` (nuovo: oggi locale, formati, scaduta/oggi/futura)
- **description**: viste come link con conteggi e `aria-current` (*"Da smistare, 288"*), sottotitolo della vista Da
  smistare; filtri primari (Cerca, Stato, Lista, Fonte, Prossima azione) e **Altri filtri** (Post, Azienda, ICP, Fit,
  Recapiti), tutti nell'URL, chip dei filtri attivi, valori invalidi → default; righe B7 (nome + headline/ruolo, fonti con tooltip *"Aggiunta a mano · incontro del 12 set"* da `met_on`,
  azienda con link, stato, liste o *"Nessuna lista"*, prossima azione come *"Scaduta · lun 15 set"* / *"Oggi"* / data con
  `<time>`, fit con ICP scelto, *"Aggiunta il"*); ordinamenti B8; hint B6 *"Anche N persone scartate corrispondono a
  '…'"* + **Mostrale**; BulkBar con **Scarta**/**Ripristina** + **Cambia stato ▾**, Arricchisci…/Analizza… (preview con
  *"N senza LinkedIn: escluse"*); **Aggiungi persona**; empty state a CRM vuoto con le tre strade (B10) e filtro
  impossibile (*"Le persone aggiunte a mano non passano da Da smistare."*); avviso del popover di stato su chi ha una
  prossima azione.
- **validation**: FLOW B.4–B.5 (senza ⌘K), C.2–C.3 e Outcome (C.1 dipende dai testi di T15 e da "Dettagli del run"
  di T34: si verifica in T16 e T36); selezione azzerata cambiando vista e conservata tra pagine/filtri della stessa
  vista; focus dopo le azioni bulk (lezione TD-4); reload/back conservano vista e filtri; caricamento fallito della
  lista (`fail-next`) → ErrorBox + **Riprova** con la sidebar usabile.
- **status**: Done
- **log**: 2026-09-18: `people.index.tsx` riscritta: viste come link con conteggio (`view-counts`, `aria-label` "Da smistare, 9", `activeOptions exact`), sottotitolo di Da smistare con l'ultimo sync, filtri primari (Cerca, Stato, Lista con "Nessuna lista", Fonte con "Aggiunta a mano", Prossima azione, Ordinamento) e "Altri filtri" (Post, Azienda collegata, ICP, Fit, Recapiti), chip, hint B6 con **Mostrale**, BulkBar (Aggiungi a lista, Scarta/Ripristina, Cambia stato, Arricchisci…, Analizza…), empty state (CRM vuoto con le tre strade, filtro impossibile, Da smistare vuota, Scartate/Con prossima azione vuote, nessun risultato), selezione azzerata al cambio di vista, focus sul riepilogo dopo le azioni bulk. `ProspectTable`: colonne `nextAction` ("Scaduta · lun 15 set"/"Oggi"/data con `<time>`) e `addedAt` ("Aggiunta il" = `created_at`, al posto di "Catturato il"), azienda linkata se collegata, "Nessuna lista", tooltip "Aggiunta a mano · incontro del 12 set". `lib/dates.ts` (`todayLocal`, `useToday` con `visibilitychange`, formati). Deviazione: l'avviso "ha una prossima azione" allo Scarta è nel toast dell'esito (niente popover di conferma nella BulkBar). Browser: selezione azzerata passando a Scartate (`?view=scartate`), back ✓; Scarta di 2 → toast "2 scartate. Le ritrovi in Scartate.", conteggi e badge 9→7, focus sul riepilogo ✓; `q=beta` → "Anche 2 persone scartate corrispondono a 'beta'. Mostrale" → `?view=scartate&q=beta` ✓; Ripristina ✓; Da smistare + Aggiunta a mano → testo del filtro impossibile ✓; `fail-next` su `GET /api/prospects` → ErrorBox + Riprova con la sidebar usabile, poi i dati ✓.
- **files edited/created**: `web/src/routes/people.index.tsx`, `web/src/components/ProspectTable.tsx`, `web/src/lib/dates.ts` (nuovo), `web/src/routes/companies.$id.tsx`, `web/src/routes/lists.$id.tsx`
- **backlog_item_id**: PF-S2
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#B. Persone]]
- **relation_mode**: body-links
- **tdd_target**: In `/people` la vista Da smistare mostra le persone arrivate dai job senza liste, con il conteggio nel
  link; scegliendo "Scartate" la selezione si azzera e l'URL diventa `?view=scartate`.
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T12: FE pagina Aggiungi persona

- **depends_on**: [T10]
- **location**: `web/src/routes/people.new.tsx` (nuovo), `web/src/components/CompanyPicker.tsx` (nuovo),
  `web/src/components/DuplicatePanel.tsx` (nuovo), `web/src/components/NextActionFields.tsx` (nuovo)
- **description**: pagina di FLOW A.1–A.6: quattro `fieldset` (Persona · Recapiti · Incontro · Nel CRM), focus su Nome,
  **Salva** / **Salva e aggiungi un'altra** / Annulla; `CompanyPicker` (ricerca per nome, dominio, pagina LinkedIn; chip
  "Collegata"; solo testo con hint; *"Crea l'azienda '…'…"* con pannello inline e 409 `company_exists` → **Collega
  quella**, D3); doppioni all'uscita dal campo (LinkedIn, email, nome) con i testi e i riepiloghi di A.4–A.6, radio senza
  preselezione, avvisi "ha già una prossima azione" / "ha già la fonte" / "è scartato"; "Salva e aggiungi un'altra" con
  riga *"Restano per la prossima persona: …"*, **Svuota tutto**, *"Aggiunte ora (N)"*, live region; `?company=` e
  `?name=` (solo al primo caricamento); guard d'uscita (Annulla, navigazione, chiusura tab).
- **validation**: tutte le righe d'errore del form di FLOW (nome, recapiti, URL, email, data mancante, LinkedIn già
  nel CRM anche per corsa, email senza scelta, persona di "Aggiungi l'incontro" sparita (unita via API
  `POST /api/prospects/:id/merge` prima di salvare), lista archiviata, salvataggio fallito (`fail-next`) con valori
  conservati, crea azienda senza chiavi / chiave già usata, azienda sparita,
  `?company=` inesistente), focus sul primo campo errato e `aria-describedby`, data passata (*"Data passata: comparirà
  come scaduta."*).
- **status**: Done
- **log**: 2026-09-18: `people.new.tsx` (quattro `fieldset`, focus su Nome, Salva / Salva e aggiungi un'altra / Annulla, `?company=` e `?name=` solo al primo caricamento, doppioni all'uscita dai campi con un'unica `GET /duplicates`, pannelli C7 (checkbox "Aggiungi l'incontro a …"), C8 (radio senza preselezione + "Crea comunque"), C10 (avviso non bloccante), riepilogo C9 con prossima azione sostituita / fonte già presente / scartata, riga "Restano per la prossima persona: …" + Svuota tutto, "Aggiunte ora (N)", live region, guard d'uscita con `useBlocker` (dialog *Uscire senza salvare?* con focus su Resta, anche `beforeunload`). Componenti nuovi: `CompanyPicker` (combobox con `aria-activedescendant`, "Crea l'azienda '…'…" con pannello inline, `company_exists` → **Collega quella**, `LinkedCompanyChip`), `DuplicatePanel` (`PersonRefLine`, `MeetingSummary`), `NextActionFields` (Domani / Tra una settimana, "Data passata: comparirà come scaduta."); `ListPicker` con `noneOption` "Nessuna lista". Deviazione: la data della fonte di `PersonRef` si formatta in FE. Browser (viewport 1280×900; agent-browser non clicca elementi fuori schermo senza `scrollintoview`): target (Luca Bassi, Salva e aggiungi un'altra → form vuoto tranne contesto/data/lista/stato, "Aggiunte ora (1)", focus su Nome, live region) ✓; azienda Nuvola scelta con Invio ✓; C7 blocca e porta il focus sulla scelta, poi incontro aggiunto (fonte manuale con data + nota) ✓; C8 senza scelta → errore sul gruppo e focus, "Crea comunque" → scheda nuova ✓; C10 senza scelta crea una nuova persona ✓; errori di C3 con focus sul primo e `aria-describedby` ✓; salvataggio fallito (`fail-next`) con valori conservati ✓; guard d'uscita Resta/Esci ✓; `?company=8` → "Collegata: Nuvola Srl", `?company=9999` → messaggio ✓; crea azienda senza chiavi / chiave già usata → "Collega quella" ✓; persona dell'incontro unita via API prima di salvare → messaggio e pannello ricalcolato ✓; lista archiviata → messaggio ✓; data passata ✓.
- **files edited/created**: `web/src/routes/people.new.tsx`, `web/src/components/CompanyPicker.tsx`, `web/src/components/DuplicatePanel.tsx`, `web/src/components/NextActionFields.tsx` (nuovi), `web/src/components/ListPicker.tsx`
- **backlog_item_id**: PF-S3
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#C. Aggiungere una persona a mano]]
- **relation_mode**: body-links
- **tdd_target**: Da `/people/new` inserisco "Luca Bassi" con email e contesto e premo "Salva e aggiungi un'altra":
  toast *"Persona aggiunta: Luca Bassi"*, form vuoto tranne contesto, data, lista e stato, focus su Nome.
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T13: FE scheda persona (azienda, dati a mano, prossima azione) e scheda azienda

- **depends_on**: [T10, T12]
- **location**: `web/src/routes/people.$id.tsx`, `web/src/components/CompanyLinkControls.tsx` (nuovo),
  `web/src/components/NextActionCard.tsx` (nuovo), `web/src/components/PersonPicker.tsx` (nuovo),
  `web/src/routes/companies.$id.tsx`
- **description**: riga Azienda di FLOW I.1–I.3 (collegata / solo testo *"· non collegata"* / vuota; **Collega**,
  **Cambia azienda**, **Scollega**; *"Collegata da te: i job non cambiano questo collegamento."*); marcatore *"a mano"*
  con tooltip e *"vuota · svuotata a mano"* (D8, D9); Arricchisci/Analizza disabilitati con il motivo per chi non ha
  LinkedIn (E11); prossima azione in testata: stato testuale (G3), **Imposta** / **Modifica** / **Rimuovi** (P-25);
  badge "In Inbox" → *"Nessuna lista"* + **Aggiungi a lista**; nelle Fonti la fonte manuale come *"Aggiunta a mano ·
  incontro del 12 set"* (`met_on`, C5). Scheda azienda: sezione **Persone (N)** con le sole
  collegate, **Aggiungi persona** (`/people/new?company=`), **Collega una persona esistente** (`PersonPicker`, *"Ora
  collegata a Beta: collegandola qui lascia Beta."*), **Estrai persone**, testo del vuoto di FLOW I.4.
- **validation**: FLOW I.1–I.4; errori "Azienda scelta sparita" (azienda unita via API prima di collegare) e
  "scrittura fallita" (`fail-next` su `PUT …/company` e `PUT …/next-action`) con errore accanto al controllo e valori
  conservati; toast di Collega/Scollega; prossima azione impostata, modificata, rimossa, con data passata.
- **status**: Done
- **log**: 2026-09-18: `CompanyLinkControls` (riga Azienda: collegata → link + Cambia azienda · Scollega + "Collegata da te: i job non cambiano questo collegamento."; solo testo → "<nome> · non collegata"; vuota → "Nessuna azienda"; dialog con `CompanyPicker` precompilato col testo, **Collega**, 404 → "Azienda non trovata: forse è stata unita a un'altra. Cercala di nuovo."), `NextActionCard` in testata (stato testuale scaduta/oggi/futura con `<time>`, Imposta / Modifica con dentro Rimuovi, errore accanto al controllo, avviso sulle scartate), `PersonPicker` → `LinkPersonDialog` ("Ora collegata a Beta: collegandola qui lascia Beta."). Scheda: marcatore "a mano" / "vuota · svuotata a mano" con testo per screen reader, "Azienda (testo)" solo se non collegata, Arricchisci e l'azione di `AnalysisCard` (`disabledReason`) disabilitati col motivo senza LinkedIn, "Nessuna lista", fonte "Aggiunta a mano · incontro del 12 set". Server: `linked_company_name` nel dettaglio. Scheda azienda: "Persone (N)" solo collegate, Aggiungi persona (`/people/new?company=`), Collega una persona esistente, Estrai persone, testo del vuoto di FLOW I.4. Browser: target (Marco Riva "Beta · non collegata" → Collega, ricerca precompilata "Beta" → Beta Payroll → link + "Collegata da te…" e persona in `?companyId=3`) ✓; Scollega → "Azienda scollegata: resta 'Beta' come testo." ✓; `fail-next` su `PUT …/next-action` → errore, testo conservato, poi salvata ✓; Rimuovi ✓; azienda unita via API a dialog aperto → messaggio ✓; "a mano" su Ruolo ✓; Giulia (senza LinkedIn): Arricchisci e "Arricchisci e analizza" disabilitati col motivo, niente "Apri su LinkedIn" ✓; Nuvola: vuoto con testo di I.4 e link `?company=8`, collega Carlo Gentile (collegato ad Acme, avviso) → Persone (1) ✓.
- **files edited/created**: `web/src/components/CompanyLinkControls.tsx`, `web/src/components/NextActionCard.tsx`, `web/src/components/PersonPicker.tsx` (nuovi), `web/src/routes/people.$id.tsx`, `web/src/routes/companies.$id.tsx`, `web/src/components/AnalysisCard.tsx`, `web/src/api/types.ts`, `src/db/prospects.ts`
- **backlog_item_id**: PF-S4
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#D. Persona ↔ azienda]]
- **relation_mode**: body-links
- **tdd_target**: Nella scheda di una persona con azienda solo testo, "Collega a un'azienda" (ricerca precompilata)
  collega "Acme": la riga mostra il link ad Acme e *"Collegata da te: i job non cambiano questo collegamento."*, e la
  persona compare in Persone di Acme.
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T14: FE LinkedIn, conflitti d'identità e Unisci

- **depends_on**: [T13]
- **location**: `web/src/routes/people.$id.tsx` (Anagrafica), `web/src/components/MergeDialog.tsx` (nuovo)
- **description**: FLOW F.1–F.5: **Aggiungi profilo LinkedIn** al posto di "Apri su LinkedIn" (E12) con focus sul campo;
  LinkedIn correggibile finché ci sono solo fonti manuali, poi di sola lettura col motivo (E3); pannello di conflitto
  (E5) con **Unisci … in questa persona…** / **Annulla la modifica**; email di altri con **Unisci** / **Salva
  comunque**; profili distinti senza Unisci (E7); `MergeDialog` con *"Confluiscono"*, profilo LinkedIn, *"Si
  aggiungono"*, tabella *"Valori in conflitto"* (caption, Resta/Si perde come testo), *"L'unione non si può
  annullare."*, focus iniziale su **Annulla**; toast *"Persone unite: resta …"*.
- **validation**: FLOW F.1–F.5; righe d'errore "Svuotare il LinkedIn", "Svuotare email e telefono senza LinkedIn",
  "LinkedIn di un'altra persona", "Unisci: l'altra persona sparita / 500" (`role="alert"`; sparita = unita via API a
  dialog aperto, 500 = `fail-next` su `POST …/merge`).
- **status**: Done
- **log**: 2026-09-18. Campo **Profilo LinkedIn** in cima all'Anagrafica (id `person-<id>-linkedin`, focus da **Aggiungi profilo LinkedIn** dell'header, E12); di sola lettura col motivo se c'è e la persona ha fonti dei job (E3). Pannelli di conflitto sotto il campo (`linkedin_taken`: Unisci / Annulla la modifica o il motivo E7) e sotto la griglia (`email_taken`: per persona Unisci o motivo, **Salva comunque**); E4 con **Ripristina**; ogni modifica chiude l'esito precedente. `MergeDialog`: Confluiscono, Profilo LinkedIn (di chi è l'URL e l'id membro), Si aggiungono, tabella con caption, 'L'unione non si può annullare.', focus iniziale su Annulla e ritorno del focus al bottone che l'ha aperto; dopo l'unione focus sul LinkedIn. Server: `member_urn_from` nell'anteprima e `mergeable`/`reason` per persona in `email_taken` (test in api-people-identity). Browser (seed e2e): TDD target Giulia #21 ← #20 con toast, Apri su LinkedIn, Fonti (2), Arricchisci attivo, badge 9→8, stato Qualificato senza nuova voce; tabella con Stato Qualificato/Nuovo; sparita (#20 unita via API) → alert; 500 (fail-next) → ErrorBox e Unisci riuscito al secondo colpo; URL libero → 'Profilo LinkedIn aggiunto'; svuotare → 'Il profilo LinkedIn non si può rimuovere.'; E4; E7 su LinkedIn ed email; email scritta in 'Resta'.
- **files edited/created**: `web/src/routes/people.$id.tsx`, `web/src/components/MergeDialog.tsx` (nuovo), `web/src/components/ui/dialog.tsx` (sr-only 'Chiudi'), `web/src/api/types.ts`, `src/db/person-merge.ts`, `src/db/people.ts`, `tests/api-people-identity.test.ts`
- **backlog_item_id**: PF-S5
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#E. Identità delle persone]]
- **relation_mode**: body-links
- **tdd_target**: Sulla scheda di Giulia Neri (solo email) incollo il LinkedIn della Giulia Neri arrivata dai job: nulla
  si salva e compare *"Unisci Giulia Neri in questa persona…"*; confermando, la scheda mostra "Apri su LinkedIn" e le
  fonti di entrambe.
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T15: Onboarding a tre strade, home di M1, testi (A3)

- **depends_on**: [T11]
- **location**: `web/src/routes/index.tsx`, testi FE (tutte le route e i componenti), `web/src/lib/jobs.ts`
  (etichette), `src/server/jobs.ts` (`JOB_KIND_LABELS`), riassunti e warning dei job (`src/jobs/*.ts`, compresi
  `analyze.ts:204,249,371` e il sync), messaggi d'errore delle route (`src/server/routes/*.ts`), test che li
  controllano
- **description**: `/` = onboarding *"Porta dentro le prime persone"* con le tre card di FLOW H.1 (sempre attiva la
  strada manuale; sync senza profilo disabilitato con **Salva il profilo** → `/settings#profilo`, P-24; aziende senza
  ICP disabilitato con **Crea ICP**) e lo stesso promemoria *"Da completare: …"*; con almeno una persona redirect a
  `/people` (P-16). Sostituzioni della tabella "Testi che cambiano" del FLOW (P-21): marchio, "Persona non trovata",
  "Persone", "Aggiunta il", esiti del sync (*"N nuove persone da smistare"*), "Persone di un'azienda", `sr-only`,
  messaggi API. I riassunti storici non si toccano.
- **validation** (cli): test aggiornati verdi; `rg -n "[Pp]rospect|Inbox"` su `src/` e `web/src/` resta solo in
  identificatori, path e commenti (checklist nel log). (browser): onboarding a DB vuoto (reset) con requisiti scritti;
  con il seed `/` → `/people`; testo delle pagine visitate senza "prospect"/"Inbox".
- **status**: Done
- **log**: 2026-09-18. `/` = onboarding *Porta dentro le prime persone* con le tre card (`StartPaths`, riusate da Persone a CRM vuoto, B10) e il promemoria `SetupReminder` (*Da completare: …*, link a `/settings#profilo`, `/settings#azienda` — ancora nuova, con focus sulla descrizione — `/icps`, `/settings`; P-24; riusabile da Oggi in M2); con almeno una persona `/` → `/people` (P-16). Testi A3: server 'Persona non trovata.' (`PERSON_NOT_FOUND_MESSAGE`, 8 punti), sync *N nuove persone da smistare*, `JOB_KIND_LABELS`/`lib/jobs.ts` *Persone di un'azienda*, riassunto *Persone di <azienda>: …*, analisi (blocker Apify, *nessuna persona da analizzare*, *N persone non analizzate*), export vuoto, 'Persona inesistente'; FE: export (*Esporta N persone*, *Porta a 'Contattato' le persone esportate*), colonne *Persone* (Aziende, export della lista, I miei post), caption *Persone della lista X*, *Nessuna persona corrisponde ai filtri.*, SyncDialog, AddToList, IcpPicker, TouchpointForm (*Nessuna*), ICP, azienda, lista archiviata e Impostazioni senza 'sourcing'. Test aggiornati: api-prospects (TDD 404), sync-interactions, analyze, jobs, source-company, list-export. Checklist `rg -n "[Pp]rospect|Inbox"` (1302 righe): restano identificatori (`Prospect*`, `prospect_id`, `prospects_new`, `listInbox`…), path (`/api/prospects`, `/api/inbox`, `/inbox` redirect), commenti, il gruppo 'Prospecting' della sidebar (FLOW) e l'attributo `data-prospect-id`. Browser: reset → onboarding (sync e azienda disabilitati coi requisiti, link che portano il focus), Persone a CRM vuoto con le stesse card, profilo salvato → Sincronizza → toast *7 nuove persone da smistare* + 'Apri Da smistare' e `/` → `/people`; testo di 12 pagine (Persone, viste, schede, nuova, liste, aziende, ICP, Impostazioni) senza 'prospect'/'Inbox'/'sourcing'.
- **files edited/created**: `web/src/routes/index.tsx`, `web/src/components/StartPaths.tsx` (nuovo), `web/src/components/SetupReminder.tsx` (nuovo), `web/src/routes/people.index.tsx`, `web/src/routes/settings.tsx`, `web/src/routes/{people.$id,lists.index,lists.$id,companies.index,companies.$id,icps.$id}.tsx`, `web/src/components/{ExportDialog,SyncDialog,IcpPickerDialog,AddToListDialog,TouchpointForm}.tsx`, `web/src/lib/jobs.ts`, `src/server/jobs.ts`, `src/jobs/{sync-interactions,analyze,source-company}.ts`, `src/exports/list-export.ts`, `src/server/routes/{prospects,analyze,enrich}.ts`, `src/db/{people,identity,person-merge}.ts`, test: `api-prospects`, `sync-interactions`, `analyze`, `jobs`, `source-company`, `list-export`
- **backlog_item_id**: PF-S1
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#A. Navigazione]]
- **relation_mode**: body-links
- **tdd_target**: `GET /api/prospects/9999` → 404 `{error: 'Persona non trovata.'}` e il riassunto di un sync finto dice
  *"N nuove persone da smistare"*.
- **review_mode**: mixed
- **assigned_skills**: agent-browser

### T16: Smoke M1 e documenti di tappa

- **depends_on**: [T2, T6, T11, T12, T13, T14, T15]
- **location**: `tests/e2e/smoke-people.md` (nuovo), `AGENTS.md` (Prospect identity), `tests/e2e/README.md`,
  `brain/specs/prospect-crm/people-first-crm/IMPLEMENTATION-NOTES.md` (nuovo, sezione M1)
- **description**: smoke `agent-browser` (percorsi dell'ux-advisor): H.1 a DB vuoto; A.1–A.6 con tre persone di fila e
  i doppioni C7, C8, C10; B.4–B.5 col filtro testo ("devfest"); C con *"N senza LinkedIn: escluse"*; F.1–F.5; I.1–I.4;
  verifica D7/D8 (ruolo e azienda cambiati a mano, arricchimento finto, valori e marcatore restano); redirect A4/A5;
  ritorno A7 dopo un reload; C.1 con i testi nuovi (senza "Dettagli del run", che arriva in M3); righe d'errore da
  "Nome vuoto" a "Persona inesistente" (compreso "Salvataggio fallito");
  testo delle pagine senza "prospect"/"Inbox". Documenti: regola **Prospect identity** del root `AGENTS.md`
  (`linkedin_url` facoltativo, email non chiave, creazione manuale, `manual_fields` + `jobAssign`, unione manuale e
  automatica); README e2e; IMPLEMENTATION-NOTES M1 (deviazioni, sorprese, esito di T2). **Stop di tappa**: messaggio
  all'utente con cosa provare, numeri di T2, dove sarà il backup (`data/crm.db.bak-<ISO>` al primo avvio) e la richiesta
  che **alla ripresa di M2 l'agente fermerà il server reale se è acceso** (§5).
- **validation**: smoke senza BLOCKER (esiti in `smoke-people.md`); 4 gate verdi.
- **status**: Done
- **log**: 2026-09-18. Smoke M1 con agent-browser fatto da un agente separato (sessione `smoke-m1`) su server e2e :8841 + Vite :5191: H.1, A.1–A.6 con C7/C8/C10, B.4–B.5 ('devfest'), C (anche 'N senza LinkedIn'), F.1–F.5, I.1–I.4, D7/D8, A4/A5/A7, C.1, righe d'errore da 'Nome vuoto' a 'Persona inesistente' (anche 'Salvataggio fallito'), testo delle pagine → **0 BLOCKER, 2 MAJOR, 18 MINOR** (`tests/e2e/smoke-people.md`). Corretti: MAJOR-1 (ricerca per URL/dominio normalizzati su Persone e Aziende, test in api-people-list e api-companies), MAJOR-2 (focus dopo la scelta dell'azienda) e i MINOR 1–9, 11–13, 15–18, 10 e 14 in parte (anche `moving_labels` nell'anteprima di Unisci, test in api-people-identity; accordo 'esclusa', test in no-linkedin e manual-data-jobs); ricontrollati nel browser. Documenti: regola **Prospect identity** del root `AGENTS.md` (LinkedIn facoltativo, email non chiave, `createPerson`/`editPerson`, `manual_fields` + `jobAssign`, unioni in `person-merge.ts`) e gotcha e2e; README e2e (testi nuovi, onboarding); IMPLEMENTATION-NOTES M1. Gate: typecheck, 44 file / 579 test, build e typecheck web verdi.
- **files edited/created**: `tests/e2e/smoke-people.md` (nuovo), `AGENTS.md`, `tests/e2e/README.md`, `brain/specs/prospect-crm/people-first-crm/IMPLEMENTATION-NOTES.md`, correzioni: `src/db/{prospects,companies,person-merge}.ts`, `src/jobs/{errors,enrich}.ts`, `src/server/routes/{enrich,analyze}.ts`, `web/index.html`, `web/src/components/{CompanyPicker,CompanyLinkControls,MergeDialog,AddToListDialog,PersonPicker,StatusSelect,Timeline}.tsx`, `web/src/routes/{people.index,people.new,people.$id}.tsx`, `web/src/api/types.ts`, test `api-people-list`, `api-companies`, `api-people-identity`, `no-linkedin`, `manual-data-jobs`
- **backlog_item_id**: PF-S11
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#K. Coerenza con il dominio]]
- **relation_mode**: body-links
- **tdd_target**: n/a (smoke di tappa, non TDD): verifica = lo smoke M1 percorre FLOW A, B (senza ⌘K), C, F, H, I e
  le righe d'errore del form senza BLOCKER.
- **review_mode**: mixed
- **assigned_skills**: agent-browser

### M2 — Seguire le persone

### T17: "Riprova" dalla preview (API)

- **depends_on**: [T16]
- **location**: `src/jobs/{sync-interactions,source-company,enrich,analyze,enrich-companies,lookalike-companies,apollo-people}.ts`
  (`previewFromParams`), `src/jobs/handlers.ts` (`RETRY_PREVIEWS`), `src/server/routes/jobs.ts`, route di preview dei
  kind (riuso), `tests/jobs.test.ts` + test di preview dei kind
- **description**: prima di iniziare, `lsof data/crm.db data/crm.db-wal` e `pgrep -f "src/server/index.ts|job-entry"`
  senza processi sul DB reale; altrimenti fermarli come dice §5 (per PID, mai durante un job: da qui lo schema non cambia
  più, ma i figli partirebbero dal codice a metà). Ogni kind esporta `previewFromParams(params): JobPreview` costruita sulle sue funzioni `plan*` (la
  route della preview la usa quando il suo input coincide con i `params`); registry `RETRY_PREVIEWS` in `handlers.ts`
  (come `CONFIG_BLOCKERS`); `GET /api/jobs/:id/retry-preview` → preview + blocker "job in corso" (`withRunningBlocker`)
  per un job `failed`; altrimenti 409 `job_not_failed`; 404. `POST /jobs/:id/retry` invariato. Chiude TD-25 residuo
  lato server.
- **validation**: per ogni kind, `retry-preview` di un job fallito = preview del kind con gli stessi parametri (stessi
  `counts`, `est_cost_usd`, `warnings`); chiave tolta → blocker; job in corso → blocker; 409 su job riuscito.
- **status**: Done
- **log**: 2026-09-19. Controllo di ripresa: `lsof data/crm.db data/crm.db-wal` e `pgrep` senza processi (server reale spento). Ogni kind esporta `previewFromParams(params)` (preview senza "job in corso"): sync = `previewSync` + `configBlockers`; `enrich`, `analyze` e `source_company` (`planSourcing`) spostati dalle route nei file dei kind, che ora li usano; `enrich_companies` ricalcola lo stesso ambito (referenze dell'ICP o l'azienda del dettaglio); `lookalike_companies` passa filtri, pagine, dimensione, pipeline e la `startPage` congelata (nuovo `LookalikeInput.startPage`: se diversa dalla ripartenza calcolata vince quella del run, con l'avviso *"Riparte dalla pagina N come il run da riprovare…"*); `apollo_people` = `planContacts(params)`. Registry `RETRY_PREVIEWS` in `handlers.ts`, `retryPreview(id)` in `server/jobs.ts`, `GET /api/jobs/:id/retry-preview` (200 preview + blocker "job in corso" · 409 `job_not_failed` · 404). `POST /jobs/:id/retry` invariato (blocker di configurazione). Test: ogni kind avviato dalla sua route vera con figlio finto che fallisce → `retry-preview` = preview del kind con la stessa query (counts, stima, avvisi, blocchi), APIFY_TOKEN tolto → blocker, job in corso → blocker in coda, 409/404, nessuna riga nuova. Gate: typecheck, 44 file / 583 test.
- **files edited/created**: `src/jobs/{sync-interactions,enrich,analyze,source-company,enrich-companies,lookalike-companies,apollo-people,handlers}.ts`, `src/server/jobs.ts`, `src/server/routes/{jobs,sync,enrich,analyze,companies}.ts`, `tests/jobs.test.ts`
- **backlog_item_id**: PF-S10
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#J. Impostazioni e Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: `GET /api/jobs/:id/retry-preview` di un `enrich` fallito → stessi `counts` ed `est_cost_usd` di
  `/api/enrich/preview` con gli stessi parametri; tolta la chiave, `blockers` contiene il blocker dell'`APIFY_TOKEN`.
- **review_mode**: cli

### T18: FE "Riprova…" con preview (banner, Ultimi job)

- **depends_on**: [T17]
- **location**: `web/src/components/RetryPreviewDialog.tsx` (nuovo), `web/src/lib/jobs.ts`,
  `web/src/components/JobBanner.tsx`, `web/src/routes/settings.tsx` (sezione "Ultimi job", finché esiste)
- **description**: **Riprova…** (con i puntini, hint *"Apre l'anteprima con gli stessi parametri: conteggi, stima e
  blocchi ricalcolati adesso."*) apre `JobPreviewDialog` titolato *"Riprova: <operazione>"* con i conteggi del kind;
  "Avvia" chiama `POST /jobs/:id/retry`; il vecchio retry diretto sparisce.
- **validation**: FLOW G.5 dal banner e da "Ultimi job"; blocchi con avvio disabilitato; corsa 409 → toast *"C'è già un
  job in corso: …"*; nessun job parte senza "Avvia".
- **status**: Done
- **log**: 2026-09-19. `RetryPreviewDialog` (nuovo): `JobPreviewDialog` titolato *"Riprova: <operazione>"* (`jobKindLabel`) con la preview di `GET /api/jobs/:id/retry-preview` (`useRetryPreview`, sempre fresca e invalidata con le altre preview) e i conteggi del kind (`countLabels` per kind: i riepiloghi dei dialog dei kind dipendono dal loro stato); "Avvia" = `POST /jobs/:id/retry` (`useRetryJob`). Bottone **Riprova…** con hint *"Apre l'anteprima con gli stessi parametri: conteggi, stima e blocchi ricalcolati adesso."* (`title` + descrizione `sr-only`) nel `JobBanner` e in "Ultimi job"; il retry diretto e il riquadro "Riprova bloccata" del banner spariscono (i blocchi stanno nella preview); in "Ultimi job" il bottone resta attivo anche con un job in corso (il blocco lo mostra la preview). Testi: toast del fallito *Usa "Riprova…" nel banner a sinistra.*, rimedio della chiave Apollo *usa "Riprova…"*. Browser (e2e :8851 + Vite :5201, profilo `omar-fail-once`/`omar-fail`): banner → dialog *"Riprova: Sync interazioni"* con conteggi, stima e avviso, nessun job creato finché non si preme Avvia; profilo tolto → blocco *"Salva prima il tuo profilo LinkedIn…"* e Avvia disabilitato; corsa (sourcing avviato via curl a dialog aperto) → toast *"Job non avviato · C'è già un job in corso: Persone di un'azienda, …"*; da "Ultimi job" Avvia → job #3 con gli stessi parametri, riuscito; dal banner Avvia → il nuovo job prende il posto del fallito. Nota: su un viewport basso (577 px) il bottone del banner sta sotto la piega dentro il banner scorrevole e il click di agent-browser per ref non lo raggiunge (click via `eval`). Gate: build e typecheck web, typecheck.
- **files edited/created**: `web/src/components/RetryPreviewDialog.tsx` (nuovo), `web/src/components/JobBanner.tsx`, `web/src/routes/settings.tsx`, `web/src/lib/jobs.ts`, `web/src/api/client.ts`
- **backlog_item_id**: PF-S10
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#J. Impostazioni e Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: Dal banner di un sync fallito, "Riprova…" apre *"Riprova: Sync interazioni"* con conteggi e stima, e
  nessun job parte finché non premo "Avvia".
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T19: Fit manuale e fit effettivo (API)

- **depends_on**: [T16]
- **location**: `src/db/fits.ts` (nuovo), `src/db/prospects.ts`, `src/db/person-merge.ts`, `src/server/routes/fits.ts`
  (nuovo), `src/server/app.ts`, `src/exports/list-export.ts`, `src/db/icps.ts`, `src/server/routes/icps.ts`,
  `src/jobs/fake-deps.ts` (seed), `tests/api-fits.test.ts`
- **description**: `setManualFit`/`removeManualFit` con attività `fit_change` (ICP, prima, dopo, motivazione, F7);
  `effectiveFitSql(icpId)` = fit manuale se c'è, altrimenti lo stato di `analysisStateSql` (F2, F3), usata da riga
  (`fit_state`, `fit_origin` `tuo`/`ai`, `manual_fit`), filtro e ordinamento; CSV con fit effettivo e origine;
  `manual_fits_count` nel dettaglio ICP (F10, CASCADE già nello schema); unione: E9 automatica = `set_at` più recente
  per ICP, E6 manuale = quello della persona tenuta e riempimento degli ICP mancanti, conflitti nell'anteprima. Seed: una
  persona con AI medio e fit tuo alto. Il fit manuale vale anche senza arricchimento o LinkedIn (F1).
- **validation**: tdd target + F2 (ordinamento, CSV), F3 (stati di errore AI solo senza fit manuale), F5, F8 (`stale`
  solo AI), F10 (conteggio e cancellazione con l'ICP), unione automatica e manuale.
- **status**: Done
- **log**: 2026-09-19. `src/db/fits.ts` (nuovo): `analysisStateSql` spostata qui da `prospects.ts` (niente ciclo d'import), `effectiveFitSql(icpId)` = `COALESCE(fit manuale, stato AI)` con l'origine (`tuo`/`ai`; senza ICP solo l'AI), `effectiveFits`, `manualFitsFor`/`manualFitsOf`, `setManualFit`/`removeManualFit` in transazione `.immediate()` con attività `fit_change` (meta `{icp_id, icp_name, from, to}`, body = motivazione; stesso valore e stessa motivazione = nessuna scrittura; rimuovere un fit assente = nessuna scrittura). Router `fits.ts` (`PUT`/`DELETE /api/prospects/:id/fits/:icpId` → `{fit_state, fit_origin, manual_fit}`, 404 persona/ICP, 400 valore). Righe con `fit_state`, `fit_origin`, `manual_fit` (restano `analysis_state`/`analysis_error` dell'AI, F4); filtro `fit` e ordinamento `fit` sul fit effettivo; dettaglio con `manual_fits`; `GET /prospects/:id/analyses` con `manual_fit` (la card, F4/F8); `GET /icps/:id` con `manual_fits_count` (F10, CASCADE già nello schema); CSV con fit effettivo + colonna nuova `fit_origin` (`tuo`/`AI`). Unioni: `MergedValues.manual_fits` = `latest` (E9: per ICP il `set_at` più recente) o `keep` (E6); anteprima con conflitto `{field: 'manual_fit', label: "Fit tuo per '<ICP>'", keep, lose}` e `filled` `manual_fit`. Seed e2e: Luca Bernardi con analisi AI medio (hash reale, non "da aggiornare") e Marco Ferri con AI medio + fit tuo alto (`people.ai_medio_id`, `people.manual_fit_id`). Test `api-fits` (9: tdd target, cambia, F1 senza LinkedIn + 404/400, F3, F2 ordinamento + CSV, F8 card, F10, E9, E6); `list-export` aggiornato alla colonna `fit_origin`. Gate: typecheck, 45 file / 592 test.
- **files edited/created**: `src/db/fits.ts` (nuovo), `src/server/routes/fits.ts` (nuovo), `src/db/{prospects,person-merge,icps}.ts`, `src/server/app.ts`, `src/server/routes/analyze.ts`, `src/exports/list-export.ts`, `src/jobs/fake-deps.ts`, `tests/api-fits.test.ts` (nuovo), `tests/list-export.test.ts`
- **backlog_item_id**: PF-S6
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#F. Fit manuale per ICP]]
- **relation_mode**: body-links
- **tdd_target**: PUT fit alto su una persona con AI medio → riga con `fit_state: 'alto'`, `fit_origin: 'tuo'`, e il
  filtro `fit=alto` la include; una nuova analisi non lo cambia; DELETE → `fit_state: 'medio'`, `fit_origin: 'ai'`;
  timeline con due `fit_change`.
- **review_mode**: cli

### T20: FE fit: card, colonna, filtro, Elimina ICP

- **depends_on**: [T19]
- **location**: `web/src/components/AnalysisCard.tsx` (→ card "Fit e analisi AI"), `web/src/components/ProspectTable.tsx`,
  filtri, `web/src/routes/icps.$id.tsx`
- **description**: FLOW E.1–E.3, E.5: ICP in testa, *"Tuo: alto · AI: medio"*, errore AI sempre visibile, **Imposta /
  Cambia / Rimuovi il mio fit** (radiogroup con legend che nomina l'ICP, motivazione facoltativa), toast; colonna Fit
  *"alto · tuo"* / *"medio · AI"* / *"non analizzata"*; filtro con gli stessi valori; ordinamento *"Fit (tuo o AI)"*;
  senza ICP *"Il fit si esprime rispetto a un ICP…"* + **Crea ICP** (F9); conferma di Elimina ICP con il numero dei fit.
- **validation**: FLOW E.1–E.3, E.5; riga d'errore "Fit … scrittura fallita" (`fail-next` su `PUT …/fits/:icpId`)
  con errore accanto al controllo e valori conservati.
- **status**: Done
- **log**: 2026-09-19. Card "Fit e analisi AI" (ex "Analisi AI", `AnalysisCard`): ICP in testa (select con più ICP, "ICP: <nome>" con uno), riga del fit *"Non analizzata"* / *"AI: medio"* (+ *da aggiornare* solo sull'AI, F8) / *"Tuo: alto · AI: medio"* (F4, l'errore dell'AI resta visibile sotto), *"La tua motivazione: …"*; **Imposta il mio fit** / **Cambia il mio fit** aprono un form inline (`fieldset` + legend *"Il tuo fit per '<ICP>'"*, radiogroup Alto · Medio · Basso, *"Motivazione (facoltativa)"*, **Salva fit** · Annulla), **Rimuovi il mio fit** senza conferma; toast *"Fit impostato: alto (tuo)"* / *"Fit rimosso: vale di nuovo l'analisi AI"*; focus sul controllo che resta; errore accanto al controllo (*"Fit non salvato: … I valori scelti sono ancora qui."*); senza ICP (F9) *"Il fit si esprime rispetto a un ICP: crea il primo ICP per impostarlo."* + **Crea ICP** (`/icps/nuovo`). Colonna Fit sul fit effettivo: *"alto · tuo"*, *"medio · AI"*, *"errore · AI"*, *"non arricchibile"*, *"non analizzata"* (testo visibile), tooltip con la tua motivazione e cosa dice l'AI; filtro con le stesse voci (*"Fit alto (tuo o AI)"*, *"Non analizzate"*…); ordinamento *"Fit (tuo o AI)"* (Persone, Lista). Conferma di Elimina ICP con i fit tuoi contati (*"… le candidate, le analisi e i 2 fit che hai impostato per questo ICP; aziende e persone restano."*, senza fit la frase non c'è). La timeline rendeva già `fit_change` (M1). Browser (e2e :8851 + Vite :5201): scheda di Luca Bernardi (AI medio) → Imposta alto con motivazione → *"Tuo: alto · AI: medio"*, toast, timeline *"Fit (tuo) per 'CTO di PMI manifatturiere': nessuno → alto"*; Persone `?icp=1&sort=fit` → *"alto · tuo"* in testa; `fail-next` su `PUT /api/prospects/6/fits/1` → errore accanto al controllo con radio e motivazione conservati, poi Salva riesce; Rimuovi → *"AI: medio"*, focus su "Imposta il mio fit"; conferma di Elimina ICP con 2 fit e senza; F9 a DB senza ICP. Nota: i radio controllati da React non cambiano con `check` di agent-browser (click via `eval`). Gate: build e typecheck web.
- **files edited/created**: `web/src/components/AnalysisCard.tsx`, `web/src/components/ProspectTable.tsx`, `web/src/routes/{people.$id,people.index,lists.$id,icps.$id}.tsx`, `web/src/api/{client,types}.ts`
- **backlog_item_id**: PF-S6
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#F. Fit manuale per ICP]]
- **relation_mode**: body-links
- **tdd_target**: Nella scheda imposto "il mio fit" alto per "CTO startup IT": la card mostra *"Tuo: alto · AI: medio"* e
  la colonna Fit di Persone mostra *"alto · tuo"*.
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T21: Ricerca globale (API) + perf

- **depends_on**: [T16]
- **location**: `src/db/search.ts` (nuovo), `src/db/prospects.ts` (`personTextCondition` esportata),
  `src/server/routes/search.ts` (nuovo), `src/server/app.ts`, `src/jobs/fake-deps.ts` (`seedBulkPeople`),
  `scripts/e2e-server.ts` (`POST /api/e2e/seed-bulk`), `tests/api-search.test.ts`, `tests/perf-people.test.ts`
- **description**: `GET /api/search?q` (I2, I3): persone con la condizione di B5 (scartate incluse, con `status`),
  aziende per nome, dominio, pagina LinkedIn; al più 5 per gruppo con i totali; `q` sotto i 2 caratteri → vuoto;
  `%`/`_` escape. `seedBulkPeople(n, m)` genera il volume (persone, aziende, fonti, contesti d'incontro, prossime
  azioni) e serve sia al perf test sia al server e2e (`seed-bulk`, P-23). Perf test (Constraints, P-18).
- **validation**: tdd target + escape, minimo 2 caratteri, totali; perf: ricerca < 150 ms, prima pagina di Persone e
  conteggi delle viste < 500 ms su 10.000/2.000.
- **status**: Done
- **log**: 2026-09-19. `src/db/search.ts` (nuovo): `searchAll(q)` → persone con `personTextCondition` (la stessa di Persone, B5 = I2: nome, headline, ruolo, azienda scritta o collegata, email, telefono, URL LinkedIn, contesto dell'incontro; scartate comprese, con `status`), prima i nomi o cognomi che iniziano col testo e le scartate dopo a parità; aziende per nome, dominio e pagina LinkedIn (anche normalizzati); al più 5 per gruppo con `people_total`/`companies_total`; sotto i 2 caratteri liste vuote; `%`/`_` letterali. Router `search.ts` (`GET /api/search?q`). `seedBulkPeople(people, companies)` in `fake-deps.ts` (SQL diretto in una transazione, in aggiunta ai dati: aziende con dominio e pagina, persone con ruolo/azienda, un terzo collegate, metà con email, una fonte ciascuna, un quinto "aggiunta a mano" con nota d'incontro, un ventesimo con prossima azione da −3 a +10 giorni, un ventesimo scartate; rifiuta `data/`) e `POST /api/e2e/seed-bulk {people?, companies?}` (seed normale + volume, default 10.000/2.000) nel server e2e. Test `api-search` (3: tdd target, minimo 2 caratteri ed escape, pagina LinkedIn dell'azienda, azienda collegata) e `perf-people` (volume + soglie). Tempi misurati su 10.000/2.000 (mediana, HTTP compreso): ricerca 8–10 ms, prima pagina di Persone 5 ms, conteggi delle viste 4–5 ms, ordinamento per fit 8 ms; seed del volume ~150 ms. Gate: typecheck, 47 file / 598 test.
- **files edited/created**: `src/db/search.ts` (nuovo), `src/server/routes/search.ts` (nuovo), `src/server/app.ts`, `src/jobs/fake-deps.ts` (`seedBulkPeople`), `scripts/e2e-server.ts` (`seed-bulk`), `tests/api-search.test.ts` (nuovo), `tests/perf-people.test.ts` (nuovo)
- **backlog_item_id**: PF-S9
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#I. Ricerca globale]]
- **relation_mode**: body-links
- **tdd_target**: `GET /api/search?q=giu` → persone trovate per nome e per contesto dell'incontro, le scartate con
  `status: 'scartato'`, al più 5 per gruppo con `people_total`; aziende trovate per dominio.
- **review_mode**: cli

### T22: FE ricerca ⌘K + bottone Cerca

- **depends_on**: [T21]
- **location**: `web/src/components/CommandSearch.tsx` (nuovo), `web/src/routes/__root.tsx`, `web/src/lib/origin.ts`
- **description**: bottone **Cerca** in sidebar (*"⌘K"* / *"Ctrl K"*, `aria-keyshortcuts`); ⌘K/Ctrl+K globale con
  `preventDefault`, ignorata con un altro dialog aperto, seconda pressione chiude; combobox + listbox a gruppi (Persone,
  Aziende) con seconda riga, *"Scartata"* come testo, live region *"3 persone, 1 azienda"*, *"Ricerca…"* mantenendo i
  risultati precedenti, **Vedi tutte le persone per '…'** → `/people?q=…`, ultima voce **Aggiungi '…' come persona** →
  `/people/new?name=…`; Esc chiude e riporta il focus; origine A7 = pagina di apertura se è una delle quattro;
  debounce ≤ 100 ms e richieste superate annullate (`AbortController`, P-18).
- **validation**: FLOW B.1–B.4 solo da tastiera; *"Scrivi almeno 2 caratteri."*; *"Nessun risultato per '…'."*;
  "Ricerca fallita" + **Riprova** con testo conservato (`fail-next` su `GET /api/search`); con `seed-bulk`
  (10.000/2.000) i risultati compaiono entro 300 ms dall'ultimo tasto (misura con `performance.now()` via `eval`, nel
  log); ⌘K usabile anche sulla pagina d'errore di un caricamento fallito.
- **status**: Done
- **log**: 2026-09-19. `CommandSearch` (nuovo) montato in sidebar sotto il marchio: bottone **Cerca…** con *"⌘K"* (macOS) / *"Ctrl K"* e `aria-keyshortcuts="Meta+K Control+K"`; ⌘K/Ctrl+K a livello documento con `preventDefault` sempre, seconda pressione chiude, ignorata con un altro dialog aperto. Dialog modale (titolo sr-only *"Cerca persone e aziende"*), `input role="combobox"` (`aria-expanded`, `aria-controls`, `aria-activedescendant`) e `listbox` a gruppi etichettati (Persone, Aziende, Azioni) con seconda riga (ruolo · azienda, altrimenti headline o email per gli omonimi; dominio per le aziende), *"Scartata"* come testo, live region polite *"3 persone, 0 aziende"* / *"Scrivi almeno 2 caratteri."* / *"Nessun risultato per '…'."*, *"Ricerca…"* mantenendo i risultati precedenti, **Vedi tutte le persone per '…'** (con ≥ 1 persona) → `/people?q=…`, ultima voce **Aggiungi '…' come persona** → `/people/new?name=…`; nessuna voce attiva finché non si preme ↓ (Invio senza voce attiva apre la prima); Esc chiude e riporta il focus dove era; debounce 80 ms con `AbortController`; *"Ricerca non riuscita."* + **Riprova** (testo conservato, focus di nuovo sul campo); origine A7 = pagina di apertura se è Oggi/Persone/lista/azienda. Server: `email` nel risultato persona (seconda riga degli omonimi). Browser (e2e :8851 + Vite :5201 riavviato): dalla lista 1 ⌘K "giu" ↓↓ Invio → scheda di Giulia Neri con *"Torna a CTO manifattura Nord Italia"* e Persone attiva; Esc → focus sul bottone Cerca; seconda ⌘K chiude; con "Aggiungi a lista" aperto ⌘K ignorata (bug trovato e corretto: i dialog Radix sono `position: fixed`, `offsetParent` sempre nullo → `getClientRects()`); "zzqq" → *"Nessun risultato per 'zzqq'."* sopra la sola voce Aggiungi; Vedi tutte → `/people?q=giu`; Aggiungi → `/people/new?name=Nuovo+Contatto` col nome precompilato; `fail-next` su `GET /api/search` → errore + Riprova → risultati, testo "mar" conservato; *"Scartata"* su Giulia Marchetti scartata; ⌘K sulla pagina d'errore di Aziende (`fail-next` ×2 su `GET /api/companies`). Con `seed-bulk` (10.000/2.000) dall'ultimo tasto ai risultati (misura con `performance.now()` via `eval`, debounce compreso): rossi 111 ms, evento 124 ms, giu 110 ms, bianchi 121 ms, mar 108 ms (< 300 ms). Gate: build e typecheck web, typecheck.
- **files edited/created**: `web/src/components/CommandSearch.tsx` (nuovo), `web/src/routes/__root.tsx`, `web/src/api/{client,types}.ts`, `src/db/search.ts` (email)
- **backlog_item_id**: PF-S9
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#I. Ricerca globale]]
- **relation_mode**: body-links
- **tdd_target**: Premo ⌘K dalla lista, scrivo "giu", ↓ e Invio: si apre la scheda di Giulia Neri con *"← CTO startup
  IT"* e la voce Persone attiva.
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T23: Prossima azione: Fatto, Rimanda, touchpoint (API)

- **depends_on**: [T16]
- **location**: `src/db/next-actions.ts`, `src/server/routes/next-actions.ts`, `src/db/activities.ts`
  (`addTouchpoint`), `src/server/routes/prospects.ts` (schema touchpoint), `src/jobs/fake-deps.ts` (seed),
  `tests/api-next-actions.test.ts`
- **description**: `POST …/next-action/done {expectedSetAt}` → attività `next_action_done` col testo e prossima azione
  vuota (G4); PUT/DELETE accettano `expectedSetAt` → 409 `next_action_changed` se nel frattempo è cambiata (Rimanda =
  PUT con la nuova data, calcolata dal client da oggi, G5); touchpoint con `nextAction` facoltativo (G2; blocco vuoto =
  nessun cambio); stato e liste mai toccati (G6). Seed: prossime azioni relative al giorno del seed (−3, oggi, +3, +10;
  una su uno scartato).
- **validation**: tdd target + Rimanda, touchpoint che imposta e che sostituisce, 409 su valore vecchio.
- **status**: Done
- **log**: 2026-09-19. `src/db/next-actions.ts`: `next_action_set_at` diventa il controllo di concorrenza (sempre crescente anche nello stesso millisecondo); `changeNextAction(id, input | null, expectedSetAt?)` per PUT/DELETE (Rimanda = PUT con la nuova data calcolata dal client da oggi, G5) e `completeNextAction(id, expectedSetAt)` (**Fatto**, G4: attività `next_action_done` con body = testo e `meta.on` = la data che aveva, prossima azione vuota), entrambe in transazione `.immediate()` → `changed` se nel frattempo è cambiata o completata; `recordTouchpoint(id, input, nextAction?)` (touchpoint + prossima azione nello stesso passo, G2; blocco vuoto = nessun cambio). Route: `POST /prospects/:id/next-action/done {expectedSetAt}`, PUT e DELETE con `expectedSetAt` facoltativo (`null` = "non ce n'era", assente = nessun controllo come in M1) → 409 `next_action_changed` *"La prossima azione è già stata completata o cambiata."*; touchpoint con `nextAction {on, text}` (testo senza data → 400 `next_action_date_required`, touchpoint non registrato). Stato e liste mai toccati (G6). Seed e2e (`people.next_actions`): Paolo Ranieri scaduta (−3, *"Richiamare per la demo"*), Sara Conti oggi (*"Mandare la proposta"*), Anna Bianchi +3 (*"Follow-up dopo l'evento"*), Federico Mancini scartato (cambio di stato registrato) con prossima azione a ieri; Marco Riva resta a +10. Test `api-next-actions` (3: Fatto + 409 + seconda pressione, Rimanda/modifica/rimuovi con controllo, touchpoint che imposta e sostituisce). Gate: typecheck, 48 file / 601 test.
- **files edited/created**: `src/db/next-actions.ts`, `src/server/routes/{next-actions,prospects}.ts`, `src/jobs/fake-deps.ts` (seed), `tests/api-next-actions.test.ts` (nuovo)
- **backlog_item_id**: PF-S7
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#G. Prossima azione]]
- **relation_mode**: body-links
- **tdd_target**: POST `…/next-action/done` → prossima azione vuota, timeline *"Prossima azione completata: <testo>"*,
  stato e liste invariati; con un `expectedSetAt` superato → 409 `next_action_changed`.
- **review_mode**: cli

### T24: FE Fatto, Rimanda, touchpoint

- **depends_on**: [T23]
- **location**: `web/src/components/NextActionCard.tsx`, `web/src/components/TouchpointForm.tsx`,
  `web/src/routes/people.$id.tsx`
- **description**: in testata **Fatto** (toast con **Imposta la prossima**) · **Rimanda ▾** (Domani, Tra una settimana,
  Scegli una data…, contati da oggi) accanto a Modifica/Rimuovi; nel form touchpoint il blocco **Prossima azione** con
  *"Attuale: … Compila per sostituirla."*; nota *"Persona scartata: la prossima azione non compare in Oggi."*; bottoni
  con nome completo e focus dopo Fatto/Rimanda.
- **validation**: FLOW E.4, D.2–D.3 dalla scheda; "cambiata altrove" (due tab) → toast *"Questa prossima azione è già
  stata completata o cambiata: aggiorno la lista."* + refetch.
- **status**: Done
- **log**: 2026-09-19. `NextActionActions.tsx` (nuovo, riusato da Oggi in T26): `useCompleteNextAction` (**Fatto** senza conferma, toast *"Fatto: '<testo>' (<persona>)"* con **Imposta la prossima**), `usePostponeNextAction` (Rimanda con lo stesso testo), `PostponeMenu` (**Rimanda ▾** con `DropdownMenu` di `radix-ui`, già dipendenza: *Domani · dom 20 set*, *Tra una settimana · sab 26 set* contati da oggi, *Scegli una data…* → dialog *"Rimanda a una data"* con avviso *"Data passata: comparirà come scaduta."*), dialog globale *"Prossima azione per <persona>"* (`NextActionDialogHost` nel layout: il toast sopravvive alla riga di Oggi; salva con `expectedSetAt: null`); ogni scrittura manda `next_action_set_at` → 409 = toast *"Questa prossima azione è già stata completata o cambiata: aggiorno la lista."* + refetch. Testata della scheda (`NextActionCard`): **Fatto** · **Rimanda ▾** · **Modifica** con nomi completi (*"Fatto: Richiamare per la demo, Paolo Ranieri"*), Modifica/Rimuovi anch'essi con controllo; focus dopo Fatto su "Imposta prossima azione", dopo Rimanda su "Fatto" (tolta la `key` che rimontava la testata a ogni cambio di data); nota *"Persona scartata: la prossima azione non compare in Oggi."*. `TouchpointForm`: `fieldset` **Prossima azione** con *"Attuale: 25 set · Richiamare. Compila per sostituirla."*, vuoto = nessun cambio, testo senza data → errore sotto la data col focus (anche dal 400 del server), toast *"Touchpoint registrato · Prossima azione: 26 set"*. Timeline: *"Prossima azione completata: <testo>"*. Browser (e2e :8851 + Vite :5201 riavviati): Paolo Ranieri (scaduta −3) → Rimanda da tastiera (Invio sul trigger, ↓, Invio) a domani e con "Scegli una data…" → toast *"Rimandata a …"*, focus su Fatto; Fatto → *"Nessuna prossima azione."*, timeline, toast → Imposta la prossima → dialog → Domani + testo → salvata; completata via API a pagina aperta → Fatto → toast "cambiata altrove" e testata ricaricata; touchpoint: testo senza data → errore e focus, poi *Tra una settimana* → prossima azione sostituita; Federico Mancini scartato → nota. Gate: build e typecheck web.
- **files edited/created**: `web/src/components/NextActionActions.tsx` (nuovo), `web/src/components/{NextActionCard,TouchpointForm,Timeline}.tsx`, `web/src/routes/{people.$id,__root}.tsx`, `web/src/api/{client,types}.ts`
- **backlog_item_id**: PF-S7
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#G. Prossima azione]]
- **relation_mode**: body-links
- **tdd_target**: Nella scheda con prossima azione scaduta premo "Fatto": la testata dice *"Nessuna prossima azione."*, la
  timeline *"Prossima azione completata: Richiamare per la demo"* e il toast offre "Imposta la prossima".
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T25: Oggi (API)

- **depends_on**: [T23]
- **location**: `src/db/today.ts` (nuovo), `src/server/routes/today.ts` (nuovo), `src/server/app.ts`,
  `tests/api-today.test.ts`
- **description**: `GET /api/today?today`: `empty` (nessuna persona, H8); `due` (non scartate con prossima azione
  scaduta o di oggi, scadute prima, H2); `upcoming` (da domani a oggi + 7, H3); `to_triage` (H4); `recent` (10 per
  `created_at`, con fonte, H4); `setup_missing` (profilo, descrizione azienda, ICP, chiavi, H7); `failed_runs: []` fino
  a T34.
- **validation**: tdd target + bordi di `today`, scartati esclusi, "Aggiungi l'incontro" che non sposta `recent`,
  `empty` a zero persone.
- **status**: Done
- **log**: 2026-09-19. `src/db/today.ts` (nuovo) + router `today.ts`: `GET /api/today?today=YYYY-MM-DD` (default data locale del server; data non valida → 400) → `empty` (nessuna persona, H8), `due` (non scartate con prossima azione ≤ oggi, per data: scadute prima, H2), `upcoming` (da domani a oggi + 7, H3), righe `{id, full_name, company_name (collegata o scritta), company_id, next_action_on/text/set_at, next_action_state, status}` (il `set_at` serve a Fatto/Rimanda dalla riga); `to_triage` (stessa condizione della vista Da smistare, H4); `recent` = 10 per `created_at` con `PersonRef` (prima fonte con `met_on`) e `created_at` (H4: "Aggiungi l'incontro" non la sposta); `setup_missing` = chiavi mancanti in ordine (`profile`, `company`, `icp`, `apify`, `anthropic`, `apollo`: le etichette e i link restano quelli di `missingSetup` della FE); `failed_runs: []` fino a T34. Test `api-today` (3: tdd target con bordi di `today`, scartati esclusi, recent/da smistare con Aggiungi l'incontro, empty e voci mancanti). Gate: typecheck, 49 file / 604 test.
- **files edited/created**: `src/db/today.ts` (nuovo), `src/server/routes/today.ts` (nuovo), `src/server/app.ts`, `tests/api-today.test.ts` (nuovo)
- **backlog_item_id**: PF-S8
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#H. Oggi (home)]]
- **relation_mode**: body-links
- **tdd_target**: Con `today=2026-09-18`: le prossime azioni del 15 e del 18 settembre sono in `due` (prima quella del 15), quella del 25 in `upcoming`,
  quella del 26 in nessuno dei due, quella di uno scartato in nessuno.
- **review_mode**: cli

### T26: FE Oggi come home + voce Oggi

- **depends_on**: [T25, T24, T22]
- **location**: `web/src/routes/index.tsx`, `web/src/components/today/*` (nuovi), `web/src/routes/__root.tsx`
- **description**: `/` = Oggi con almeno una persona (H1, chiude TD-38), onboarding altrimenti (H8); voce **Oggi** in
  cima alla sidebar (A1 completa); sezioni di FLOW D.1 senza "Avvisi" dei run (arrivano in T34): promemoria compatti
  con **Nascondi** (P-15, link di P-24), **Da fare (N)**, **In arrivo · prossimi 7 giorni (N)**, **Da smistare**,
  **Ultime persone aggiunte** (link con origine Oggi), **Aggiungi persona**; testi delle sezioni vuote (H6); Fatto e
  Rimanda dalla riga; date ricalcolate quando la pagina torna visibile (hook `useToday` su `visibilitychange`/`focus`:
  non verificabile con `agent-browser`, le cui pagine sono sempre `hidden`; si controlla nel codice e si annota nel log).
- **validation**: FLOW D.1–D.3; H7 (Nascondi, poi le voci tornano quando cambia l'insieme delle mancanti); focus dopo
  Fatto/Rimanda sul Fatto della riga successiva o sul titolo; onboarding a DB vuoto.
- **status**: Done
- **log**: 2026-09-19. `/` = **Oggi** con almeno una persona (anche scartata: `empty` del server), senza redirect (H1, chiude TD-38); a CRM vuoto l'onboarding di M1 (H8). Voce **Oggi** in cima alla sidebar (attiva solo su `/`, A1 completa). Pagina: titolo *"Oggi"* + data lunga (*"sabato 19 settembre"*), **Aggiungi persona**; promemoria compatto `SetupAlerts` (*"Da completare: …"*, una voce per requisito con link e **Nascondi** — nome *"Nascondi il promemoria: <voce>"*, tooltip *"Torna se cambia cosa manca."*, firma dell'insieme in `localStorage` con `try/catch`, focus alla voce successiva o al titolo; niente sezione dei run falliti fino a T34); **Da fare (N)** (stato in testo *"Scaduta · mer 16 set"* / *"Oggi"* con `<time>`, testo, persona con origine Oggi, azienda, **Fatto** e **Rimanda ▾** dalla riga riusando `NextActionActions`; focus dopo Fatto/Rimanda sul Fatto della riga successiva o sul titolo della sezione); **In arrivo · prossimi 7 giorni (N)**; **Da smistare** (*"9 persone da smistare"* + Apri Da smistare / *"Niente da smistare."*); **Ultime persone aggiunte** (*"Marco Riva · Beta · Commento · oggi"* + Vedi tutte in Persone → `sort=added`); testi delle sezioni vuote (H6). `useToday` ricalcola "oggi" anche su `focus` oltre a `visibilitychange` (non verificabile con agent-browser, le cui pagine sono sempre `hidden`: controllato nel codice). `SETUP_ITEMS` esportato da `SetupReminder` (stesse etichette e link di M1, P-24). Browser (e2e :8851 + Vite :5201 riavviati): *"Da fare (2)"* con la scaduta prima e *"In arrivo · prossimi 7 giorni (1)"*; Fatto sulla prima riga → toast e focus sul Fatto di Sara Conti; Rimanda → Domani sull'ultima → sezione vuota col testo e focus sul titolo *"Da fare (0)"*; profilo e descrizione tolti → promemoria, Nascondi → focus sulla voce successiva, resta nascosta al reload, torna quando cambia l'insieme; link persona → *"Torna a Oggi"* → `/`; reset → onboarding con "Oggi" attiva. Corretto in corsa: la voce Oggi, figlia diretta del `nav` flessibile, si allungava (ora in un contenitore). Gate: build e typecheck web.
- **files edited/created**: `web/src/routes/{index,__root}.tsx`, `web/src/components/today/{ActionSections,PeopleSections,SetupAlerts}.tsx` (nuovi), `web/src/components/SetupReminder.tsx` (`SETUP_ITEMS`), `web/src/lib/dates.ts` (`useToday` su focus, `relativeDay`), `web/src/api/{client,types}.ts`
- **backlog_item_id**: PF-S8
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#H. Oggi (home)]]
- **relation_mode**: body-links
- **tdd_target**: Con il seed, `/` mostra "Oggi" con *"Da fare (2)"* (la scaduta per prima) e *"In arrivo · prossimi 7
  giorni (1)"*; "Fatto" sulla prima riga la toglie e porta il focus sul Fatto della riga successiva.
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T27: Smoke M2 e documenti di tappa

- **depends_on**: [T18, T20, T22, T24, T26]
- **location**: `tests/e2e/smoke-people.md`, `tests/e2e/README.md`, `AGENTS.md` (checklist del job kind:
  `previewFromParams` + `RETRY_PREVIEWS`), IMPLEMENTATION-NOTES (sezione M2)
- **description**: smoke dei percorsi dell'ux-advisor: D.1–D.3, E.1–E.5, B.1–B.3 da tastiera, H.2, touchpoint G2, H7;
  errori ed edge case "cambiata altrove" (due tab), "Ricerca fallita", scartata con prossima azione, data passata; G.5
  "Riprova…" dal banner. Documenti e **stop di tappa** con cosa provare e l'avviso che **alla ripresa di M3 l'agente
  fermerà il server reale se è acceso** (§5).
- **validation**: smoke senza BLOCKER; 4 gate verdi.
- **status**: Done
- **log**: 2026-09-19. Smoke M2 con agent-browser fatto da un agente separato (sessione `smoke-m2`, e2e :8851 + Vite :5201): D.1–D.3, E.1–E.5, B.1–B.3 solo da tastiera, H.2 (anche con una sola persona scartata), touchpoint G2, H7, "cambiata altrove", "Ricerca non riuscita", scartata con prossima azione, data passata, G.5 "Riprova…" dal banner (anche con blocchi e corsa 409), testi senza "prospect"/"Inbox", ⌘K ~120 ms su 10.000/2.000 → **0 BLOCKER, 0 MAJOR, 6 MINOR** (`tests/e2e/smoke-people.md`, sezione M2). Corretti tutti e 6 e ricontrollati nel browser: errori di Fatto/Rimanda accanto ai bottoni; focus mai sul `body` (bottoni in salvataggio con `aria-disabled`, rifocus sulla testata dopo ogni scrittura della prossima azione, dialog dal toast); testi di scarto "in Oggi"; `aria-current` doppio (marchio della sidebar ora testo, colonna Azienda tolta nella scheda azienda); toast di Fatto senza testo; Nascondi anche nell'onboarding. Passaggio `simplify` (4 revisori: riuso, semplificazione, efficienza, altitudine) sul diff di M2: stato AI con le sottoquery a finestra ristrette agli id della pagina e fit effettivo calcolato sulle righe già lette (`effectiveFit`, niente seconda query per pagina), ricerca con `COUNT(*) OVER ()` (una lettura per gruppo), `readOptionalJson` in `http.ts` (4 copie), `countManualFits`/`manualFitsOf` riusati, `DATE_REQUIRED_MESSAGE` e `cleanText` riusati, Oggi nelle invalidazioni comuni (`invalidateProspectViews`), helper di "cambiata altrove" condivisi con la scheda, `focusOrPageTitle`, costanti e `errorText`/`countText`/`companyLabel` riusati, codice morto tolto (`blockersOf`, `missingSetup`, componente `SetupReminder`). Documenti: regola del job kind in `AGENTS.md` (`previewFromParams` + `RETRY_PREVIEWS`, "Riprova…" dalla preview), README e2e (seed M2, `seed-bulk`, righe `fail-next`), IMPLEMENTATION-NOTES (sezione M2), tech-debt crm-foundation (TD-25 e TD-38 chiusi). Gate: typecheck, 49 file / 604 test, build e typecheck web. **Stop di tappa.**
- **files edited/created**: `tests/e2e/smoke-people.md` (sezione M2 + correzioni), `tests/e2e/README.md`, `AGENTS.md`, `brain/specs/prospect-crm/people-first-crm/IMPLEMENTATION-NOTES.md`, `brain/tech-debt/prospect-crm/crm-foundation.md`; correzioni e `simplify`: `src/db/{fits,prospects,search,today,icps,person-merge}.ts`, `src/server/http.ts`, `src/server/routes/{analyze,enrich,sync,next-actions,prospects}.ts`, `scripts/e2e-server.ts`, `src/jobs/fake-deps.ts`, `web/src/lib/focus.ts` (nuovo), `web/src/components/{NextActionActions,NextActionCard,AnalysisCard,TouchpointForm,CommandSearch,ProspectTable,StatusSelect,DuplicatePanel,SetupReminder,ui}.tsx`, `web/src/components/ui/button.tsx`, `web/src/components/today/{ActionSections,PeopleSections,SetupAlerts}.tsx`, `web/src/routes/{index,__root,people.index,companies.$id,settings}.tsx`, `web/src/api/client.ts`
- **backlog_item_id**: PF-S11
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#K. Coerenza con il dominio]]
- **relation_mode**: body-links
- **tdd_target**: n/a (smoke di tappa, non TDD): verifica = lo smoke M2 percorre FLOW B, D, E e G.5 senza BLOCKER.
- **review_mode**: mixed
- **assigned_skills**: agent-browser

### M3 — Connessioni

### T28: Logger dei run

- **depends_on**: [T27]
- **location**: `src/runs/log.ts` (nuovo), `src/db/runs.ts` (nuovo), `src/server/job-entry.ts`, `src/server/jobs.ts`,
  `src/db/jobs.ts`, `src/server/routes/runs.ts` (nuovo), `src/server/app.ts`, `tests/run-log.test.ts`
- **description**: prima di iniziare, stesso controllo di T17 (nessun processo sul DB reale, §5). `withRunLog(runId,
  fn)` + `runLog.info|warn|error(message)` (P-10): contesto `AsyncLocalStorage`,
  no-op fuori contesto, flush a lotti in `.immediate()`, errori di scrittura non fatali (una riga su stderr),
  troncamento al centro, redazione dei valori di `APIFY_TOKEN`/`ANTHROPIC_API_KEY`/`APOLLO_API_KEY`. `insertJob` scrive
  `logged = 1`; `runJob` scrive *"Avvio: <operazione>"* e *"Fine: completato | completato con avvisi | fallito — <errore
  attribuito>"*; il parent, quando `failIfRunning` marca il job, aggiunge la riga finale *"Fine: fallito — process: …"*.
  `GET /api/runs/:id/log?after`.
- **validation**: tdd target + 6.000 righe → 5.000 restituite, `omitted: 1000`, prima e ultima presenti; `after`;
  scrittore che fallisce senza far fallire il job; chiave finta mai presente; figlio ucciso → riga finale del parent;
  run storico → `logged: false`; 404.
- **status**: Done
- **log**: 2026-09-20. Controllo di ripresa di tappa (§5): server reale acceso (`pnpm ui`, API 8787 + Vite 5173), nessun figlio `job-entry` vivo e nessun job in corso (l'ultimo era `succeeded`) → fermato per PID (SIGTERM al `concurrently` 28048), `lsof` sul DB reale vuoto e porte libere. RED→GREEN su `tests/run-log.test.ts` (8 test). `withRunLog(jobId, fn)` + `runLog.info|warn|error` con `AsyncLocalStorage`: fuori contesto le righe si scartano, flush a lotti (50 righe o 500 ms, timer `unref`) in `appendRunLog` (`.immediate()`), errore di scrittura non fatale con **una** riga su stderr per run, messaggi oltre 2.000 caratteri troncati con "…", valori di `APIFY_TOKEN`/`ANTHROPIC_API_KEY`/`APOLLO_API_KEY` sostituiti con `***` (`redactSecrets`, riusata dalle API dei run in T30). Troncamento al centro **in scrittura** (prime 2.500 + ultime 2.500): lo spazio per run resta limitato e `omitted = MAX(seq) − COUNT(*)`. `runJob` avvolge tutto il run: *"Avvio: <operazione>"* e *"Fine: completato | completato con avvisi | fallito — <errore attribuito>"*; `insertJob` scrive `logged = 1`; `Job` acquisisce `detached`/`logged`/`tools` (con `tools` parsato da JSON). Il parent scrive la riga finale quando è lui a marcare il job (`failRun` in `server/jobs.ts`, anche nella riconciliazione), saltando i run senza log. Deviazione dalla `location`: `runOutcome`/`operationLabel`/`JOB_KIND_LABELS` in `src/runs/outcome.ts` (una sola definizione: servono già alla riga finale del log, T30 la riusa invece di ridefinirla in `runs/tools.ts`). Scoperta dal test: leggere il log di un run rimasto `running` senza pid lo riconcilia e gli aggiunge la riga finale — comportamento voluto, i test chiudono il run prima di leggere. Gate: typecheck, 50 file / 612 test.
- **files edited/created**: `src/runs/log.ts` (nuovo), `src/runs/outcome.ts` (nuovo), `src/db/runs.ts` (nuovo), `src/server/routes/runs.ts` (nuovo), `tests/run-log.test.ts` (nuovo), `src/server/job-entry.ts`, `src/server/jobs.ts`, `src/db/jobs.ts`, `src/server/app.ts`
- **backlog_item_id**: PF-S10
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#J. Impostazioni e Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: Un job eseguito con `runJob` e un handler finto che logga 3 righe → `GET /api/runs/:id/log` restituisce
  "Avvio…", le 3 righe e "Fine: completato", con orari e `seq` crescenti.
- **review_mode**: cli

### T29: Righe di log in tutti i kind + trigger e2e

- **depends_on**: [T28]
- **location**: `src/jobs/{sync-interactions,source-company,enrich,analyze,enrich-companies,lookalike-companies,apollo-people}.ts`,
  `src/analysis/analyze.ts`, `src/apollo/client.ts` (retry e attese), `src/apify/client.ts` (attese, se presenti),
  `src/jobs/fake-deps.ts` (`__fixture: 'LOG_FLOOD'` → oltre 5.000 righe), test dei kind, `tests/e2e/README.md`
- **description**: J8 con P-11: fasi, chiamate per operazione (*"Apollo · ricerca persone · Acme"*, *"Apify · profilo ·
  <nome>"*, *"Anthropic · analisi · <nome>"*), elementi elaborati, errori per elemento, warning, esito; mai dati inviati
  o ricevuti (J10).
- **validation**: un test per kind sulle righe chiave e sull'assenza delle chiavi finte; `LOG_FLOOD` produce il
  troncamento.
- **status**: Done
- **log**: 2026-09-20. RED→GREEN su `tests/run-log-kinds.test.ts` (7 test, nuovo file invece delle aggiunte ai test dei singoli kind: gli handler girano sulle deps fake del server e2e, così "reali e fake loggano uguale" si vede davvero). Vocabolario unico delle righe: `<Strumento> · <operazione> · <dettaglio>` (*"Apify · post del profilo"*, *"Apify · reazioni · pagina 1 (2 post)"*, *"Apify · commenti · <url del post>"*, *"Apify · dipendenti · Acme Cloud Srl"*, *"Apify · profilo · Mario Rossi"*, *"Anthropic · analisi · Mario Rossi"*, *"Apollo · ricerca aziende · pagina 1"*, *"Apollo · arricchimento aziende · 10 domini"*, *"Apollo · ricerca persone · Acme"*, *"Apollo · match persone · Acme (10)"*, *"Apollo · email di lavoro · 10 profili"*) ed errori per elemento come *"Errore su <soggetto>: <errore attribuito>"*. I **warning** dell'esito diventano righe del log una volta sola in `runJob` (nessuna ripetizione nei sette handler). Il rifiuto del modello è un `warn`, non un errore (J4). `keyRow` legge anche `full_name` (stessa query) per dare un nome alla riga dell'arricchimento. Client Apollo: log **iniettato** (`ApolloClientOptions.log`, default nessun log) e passato da `realDeps()` e dalle deps fake, per non importare il DB in `src/apollo/client.ts` — `scripts/apollo-smoke.ts` importa da lì e non deve aprire `data/crm.db`; logga solo attese da rate limit e ritentativi 429 (P-11). `src/apify/client.ts` non ha attese: nessuna riga. `LOG_FLOOD` è uno scenario delle deps fake che vale per **ogni** kind (5.500 righe alla risoluzione delle deps, dati invariati), documentato in `tests/e2e/README.md`. Gate: typecheck, 51 file / 619 test.
- **files edited/created**: `tests/run-log-kinds.test.ts` (nuovo), `src/jobs/{sync-interactions,source-company,enrich,enrich-companies,lookalike-companies,apollo-people,fake-deps}.ts`, `src/analysis/analyze.ts`, `src/apollo/client.ts`, `src/server/job-entry.ts`, `tests/e2e/README.md`
- **backlog_item_id**: PF-S10
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#J. Impostazioni e Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: Il job `apollo_people` con deps finte scrive *"Apollo · ricerca persone · <azienda>"* per ogni azienda
  e una riga d'errore per l'azienda fallita, e nessuna riga contiene la chiave finta.
- **review_mode**: cli

### T30: Strumenti, esiti e API Connessioni

- **depends_on**: [T28]
- **location**: `src/runs/tools.ts` (nuovo), `src/jobs/*.ts` (`toolsOf`), `src/jobs/handlers.ts` (`RUN_TOOLS`),
  `src/server/jobs.ts`, `src/server/index.ts`, `src/db/jobs.ts`, `src/db/runs.ts`, `src/server/routes/runs.ts`,
  `src/jobs/fake-deps.ts`
  (seed M3), `tests/api-runs.test.ts`, `tests/e2e-deps.test.ts`
- **description**: catalogo `TOOLS` (etichetta, variabile del `.env`, *"Abilita: …"* di FLOW G.2); `toolsOf(params)`
  per kind (J3) salvato all'avvio (per `analyze`: `anthropic` + `apify` se `planAnalysis(params).enrichTargets` non è
  vuoto); **riempimento idempotente** `fillMissingRunTools(db)` chiamato in `src/server/index.ts` prima di `serve`
  (`UPDATE jobs SET tools = <regole
  di §6> WHERE tools = '[]'`, nessuna ricostruzione né backup) per i run creati durante gli stop di M1/M2, con la
  regola di `analyze` estesa: `apify` anche quando l'errore viene da un actor Apify o nomina `APIFY_TOKEN`;
  `runOutcome(job)` (J4: con avvisi = warning o errori per elemento o rifiuti del modello); `failedTools(job)` dal
  prefisso dell'errore, con id dell'actor = testo tra `actor:` e il `:` successivo (`actor:apollo:<op>:` ha id `apollo`
  → Apollo, anche se `<op>` contiene una barra; id `<owner>/<name>`, anche di actor dismessi → Apify;
  ogni altro `actor:<id>` in un run con Anthropic → Anthropic, così resta giusto anche dopo un cambio di
  `ANALYSIS_MODEL`; `config:` → lo strumento della variabile nominata; altrimenti tutti gli strumenti del run);
  redazione dei valori delle chiavi anche in `error`, `result.summary` e `warnings` restituiti dalle API dei run (J10
  vale per log **e** dettagli); `GET /api/connections` (J2, J5: `configured` = chiave presente, `health` dall'ultimo
  run), `GET /api/connections/:tool/runs?outcome&page` (J6), `GET /api/runs/:id` (J7). Seed M3: un run precedente al
  rilascio (`logged = 0`), run falliti per strumento con log.
- **validation**: tdd target + J3 per kind; un job inserito **dopo** la migrazione con `tools = '[]'` compare nella
  pagina di Apify dopo `fillMissingRunTools`; J4 esiti e attribuzioni (anche `process:` → tutti, errore di un modello
  diverso da quello configurato → Anthropic); chiave finta assente dal dettaglio del run; filtro Falliti e
  paginazione, 404 strumento/run.
- **status**: Done
- **log**: 2026-09-20. RED→GREEN su `tests/api-runs.test.ts` (9 test) + un test del seed in `tests/e2e-deps.test.ts`. `src/runs/tools.ts`: catalogo `TOOLS` (etichetta, variabile del `.env`, "Abilita: …" di FLOW G.2, `configured()`), `toolsOfRun` (ordine salvato dal kind: il primo è il principale) e `failedTools` (id dell'actor tra `actor:` e il `:` successivo: `apollo` → Apollo, `<owner>/<name>` → Apify, ogni altro id in un run con Anthropic → Anthropic; `config:` → lo strumento della variabile nominata; altrimenti tutti). `toolsOf(params)` in ogni kind + `RUN_TOOLS` in `handlers.ts`; `startJob` li congela alla riga (`insertJob(kind, params, tools)`). `backfillJobTools` diventa `fillMissingRunTools` **esportata**, usata sia dalla migrazione sia da `src/server/index.ts` prima di `serve` (P-28, idempotente). Viste in `src/db/runs.ts` (come `db/today.ts` per Oggi): `runView` (operazione, esito, durata, strumenti, `failed_tools`), `runDetail` (+ parametri, esito completo, `logged`), `connections()` (salute onesta J5: `failing` solo se l'ultimo run dello strumento è fallito **per lui**) e `runsOfTool` paginato; `redactSecrets` applicata a errore, riassunto e warning (J10 anche nei dettagli). Route: `GET /api/connections`, `GET /api/connections/:tool/runs?outcome&page&pageSize`, `GET /api/runs/:id`. I run di uno strumento sono ordinati per **data di avvio** (non per id: il seed scrive run di giorni diversi). Seed M3 in `fake-deps.ts`: run falliti per Apollo e per Anthropic (con Apify tra gli strumenti, per vedere l'attribuzione), un sync di Apify completato con avvisi e un run precedente al rilascio (`logged = 0`), tutti con i loro log. Gate: typecheck, 52 file / 629 test.
- **files edited/created**: `src/runs/tools.ts` (nuovo), `tests/api-runs.test.ts` (nuovo), `src/db/runs.ts`, `src/db/jobs.ts`, `src/db/schema.ts`, `src/jobs/handlers.ts`, `src/jobs/{sync-interactions,source-company,enrich,analyze,enrich-companies,lookalike-companies,apollo-people,fake-deps}.ts`, `src/server/{jobs,index}.ts`, `src/server/routes/runs.ts`, `tests/e2e-deps.test.ts`
- **backlog_item_id**: PF-S10
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#J. Impostazioni e Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: Un `apollo_people` fallito con `actor:apollo:<op>: … 401` → `/api/connections` mostra Apollo con
  `last_run.outcome: 'failed'` e `health: 'failing'`; un `analyze` fallito per `config: ANTHROPIC_API_KEY…` con Apify
  tra gli strumenti conta fallito solo per Anthropic.
- **review_mode**: cli

### T31: FE Impostazioni in tre sezioni

- **depends_on**: [T30]
- **location**: `web/src/routes/settings.tsx` (layout + sotto-navigazione), `settings.index.tsx` (redirect),
  `settings.profile.tsx`, `settings.posts.tsx`, `settings.connections.index.tsx` (nuovi)
- **description**: J1: **Profilo e azienda** (ancore `#profilo`, `#azienda`) · **I miei post** · **Connessioni** con
  indirizzo proprio e sotto-navigazione a link; `/settings` → `/settings/profile` conservando l'hash (A5, P-24);
  "Configurazione" e "Ultimi job" spariscono come sezioni (il contenuto va in Connessioni, T32).
- **validation**: `/settings#azienda` → `/settings/profile#azienda` con scroll; `aria-current` nella
  sotto-navigazione; percorso *"Impostazioni › …"*.
- **status**: Done
- **log**: 2026-09-20. `settings.tsx` diventa il layout della sezione (titolo "Impostazioni", sotto-navigazione a link con `aria-current="page"` dal Link attivo, `<Outlet/>`); `settings.index.tsx` reindirizza a `/settings/profile` conservando l'ancora in `beforeLoad`. Le sezioni di crm-foundation escono da un file da 743 righe e diventano componenti (`web/src/components/settings/`): `ProfileForms.tsx` (profilo + azienda), `PostsCard.tsx`, `JobsCard.tsx` (Configurazione + Ultimi job, sostituite da T32), `parts.tsx` (classi, `errorText`, formati di data, `LoadError`, `SettingsData` = la query delle impostazioni condivisa dalle tre pagine). Verificato in browser (e2e :8852 + Vite :5202, sessione `t28`): `/settings#azienda` → `/settings/profile#azienda` con il focus sulla descrizione azienda (il deep link dell'onboarding continua a funzionare), `aria-current` sulla voce attiva, le tre sezioni con i loro h2. Percorso "Impostazioni › …" **non** sulle tre sezioni (vedi deviazione nelle note): c'è sulle pagine più profonde di T32. Gate: build e typecheck web.
- **files edited/created**: `web/src/routes/settings.tsx` (riscritto), `web/src/routes/{settings.index,settings.profile,settings.posts,settings.connections.index}.tsx` (nuovi), `web/src/components/settings/{ProfileForms,PostsCard,JobsCard,parts}.tsx` (nuovi)
- **backlog_item_id**: PF-S10
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#J. Impostazioni e Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: `/settings#azienda` apre `/settings/profile#azienda` con "Profilo e azienda" attiva nella
  sotto-navigazione.
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T32: FE Connessioni e pagina strumento

- **depends_on**: [T31]
- **location**: `web/src/routes/settings.connections.index.tsx`, `web/src/routes/settings.connections.$tool.tsx`
  (nuovo), `web/src/components/runs/*` (nuovi), `web/src/api/*`, `web/src/components/today/*` e
  `web/src/routes/index.tsx` (link definitivi)
- **description**: FLOW G.2–G.3: sottotitolo, una card per strumento (Abilita, chiave *"Configurata"* / *"Mancante:
  aggiungila al .env e riavvia il server."*, ultimo run, salute onesta J5, *"N run"*, **Vedi run**); pagina strumento con
  **Tutti · Falliti** nell'URL, colonne Operazione · Avvio · Durata · Esito · Riassunto, etichette delle operazioni
  (*Arricchimento (Apify)/(Apollo)*, *Analisi singola*, …), esiti testuali; *"Strumento non trovato"* + **Vai a
  Connessioni**.
  Qui i link provvisori di P-24 diventano definitivi: il promemoria delle chiavi di Oggi (H7) → `/settings/connections`,
  "Salva il profilo" dell'onboarding → `/settings/profile#profilo`.
- **validation**: FLOW G.2–G.3; `E2E_NO_APOLLO=1` → "Mancante"; riga *"Fallito · errore di Anthropic"* negli altri
  strumenti di un run multi-strumento; promemoria delle chiavi in Oggi che apre Connessioni; caricamento fallito di
  Connessioni (`fail-next`) → ErrorBox + **Riprova**, sidebar e ⌘K usabili.
- **status**: Done
- **log**: 2026-09-20. Client e tipi dei run (`Connection`, `RunView`, `RunDetail`, `RunLog`, `api.connections.*`, `api.runs.*`, chiavi `runs`/`connections`/`toolRuns`/`run`/`runLog`). Connessioni: sottotitolo di FLOW G.2 e una card per strumento (`components/runs/ConnectionCard.tsx`) con "Abilita: …", `APOLLO_API_KEY · Configurata` / *"· Mancante: aggiungila al .env e riavvia il server."*, ultimo run con link al dettaglio, salute onesta (J5) e "N run · Vedi run". Pagina strumento (`settings.connections.$tool.tsx`): percorso "Impostazioni › Connessioni › Apollo", filtro **Tutti · Falliti** e pagina nell'URL, colonne Operazione · Avvio · Durata · Esito · Riassunto, "Strumento non trovato" + **Vai a Connessioni**. Aggiunta rispetto al FLOW: sulla card e nella riga di un run multi-strumento fallito per un altro, la frase *"fallito per Anthropic, non per Apify"* / *"Errore di Anthropic"* — senza, il badge "Fallito" sembrerebbe dello strumento sbagliato (J4). Link definitivi (P-24): promemoria delle chiavi → `/settings/connections`, profilo e azienda → `/settings/profile#profilo|#azienda`, "Salva il profilo" dell'onboarding → `/settings/profile#profilo`. Verificato in browser: card dei tre strumenti, "Vedi run", filtro Falliti con la riga "Errore di Anthropic", strumento inesistente, `E2E_NO_APOLLO=1` → "Mancante" (server riavviato apposta e poi rimesso com'era), `fail-next` su `/api/connections` → errore + **Riprova** che recupera, sidebar e ⌘K usabili. Gate: build e typecheck web.
- **files edited/created**: `web/src/components/runs/{parts,ConnectionCard}.tsx` (nuovi), `web/src/routes/settings.connections.index.tsx` (riscritto), `web/src/routes/settings.connections.$tool.tsx` (nuovo), `web/src/routes/settings.connections.runs.$runId.tsx` (nuovo, completato in T33), `web/src/api/{client,types}.ts`, `web/src/components/SetupReminder.tsx`, `web/src/components/StartPaths.tsx`
- **backlog_item_id**: PF-S10
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#J. Impostazioni e Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: Dopo un "Contatti Apollo" fallito, `/settings/connections` mostra nella card Apollo *"Ultimo run
  fallito: …"* e "Vedi run" apre `/settings/connections/apollo` con quel run in cima ed esito "Fallito".
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T33: FE dettaglio run, log live, Riprova…

- **depends_on**: [T32, T29]
- **location**: `web/src/routes/settings.connections.runs.$runId.tsx` (nuovo), `web/src/components/runs/{RunLog,RunParams}.tsx`,
  `web/src/components/RetryPreviewDialog.tsx` (riuso)
- **description**: FLOW G.4–G.6: titolo *"<operazione> · <data>"* + esito, **Parametri** leggibili (J7), **Tempi**,
  **Esito**, **Errore** con *"Conta come fallito per: …"*, **Log** (`ol`, `<time>`, `aria-live="off"`) con polling a run
  in corso (*"In corso: il log si aggiorna da solo."*, `after`), avviso di troncamento con le righe omesse e la riga del
  taglio, *"Log non disponibile per questo run."*, **Riprova…** (T18) sui falliti; *"Run non trovato"*.
- **validation**: FLOW G.4–G.6; righe d'errore "Log non aggiornabile durante un run" (`fail-next` su
  `GET /api/runs/:id/log` a run in corso → *"Log non aggiornato: nuovo tentativo tra pochi secondi."*, righe già viste
  conservate), "Run inesistente", "Riprova con blocchi / job in corso / race 409"; `LOG_FLOOD`.
- **status**: Done
- **log**: 2026-09-20. Dettaglio del run completo: **Parametri** leggibili (`RunParams`: liste e ICP col nome da una query condivisa, id sparito → `#12`, sì/no scritti in parole, chiavi tecniche saltate), **Tempi**, **Esito** (riassunto, conteggi non nulli, warning), **Errore** con *"Conta come fallito per: …"* (o *"L'errore non nomina uno strumento: conta per … e …"*), **Log** (`RunLog`: `ol` con `<time>`, `aria-live="off"`, polling con `after` ogni 2 s a run in corso, avviso di troncamento + riga `… N righe omesse …` nel punto del taglio, *"Log non disponibile per questo run."*), **Riprova…** sui falliti (stesso `RetryPreviewDialog` di T18, dialog **sempre montato** così Radix può restituire il focus). Verificato in browser: sync lento (`E2E_FAKE_DELAY_MS=5000`) con le righe che arrivano da sole e l'esito che passa a "Completato" senza ricaricare; `fail-next` sul log → *"Log non aggiornato: nuovo tentativo tra pochi secondi."* con le righe già viste al loro posto e il recupero al tentativo dopo; `LOG_FLOOD` → 5.000 righe, *"omesse 507 righe centrali"*, avvio ed esito visibili; run inesistente → "Run non trovato" + "Vai a Connessioni"; "Riprova…" con un job in corso → blocco *"C'è già un job in corso…"* e **Avvia** disabilitato; "Annulla" non avvia niente (10 job prima e dopo). Gate: build e typecheck web.
- **files edited/created**: `web/src/components/runs/{RunLog,RunParams}.tsx` (nuovi), `web/src/routes/settings.connections.runs.$runId.tsx`, `web/src/components/RetryPreviewDialog.tsx` (prop `job` ridotta a id/kind/params)
- **backlog_item_id**: PF-S10
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#J. Impostazioni e Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: Il dettaglio di un sync avviato con `E2E_FAKE_DELAY_MS=5000` mostra le righe del log mentre il run è in
  corso, senza ricaricare, e a fine run compare "Fine: completato".
- **review_mode**: browser
- **assigned_skills**: agent-browser

### T34: Oggi: run falliti + "Dettagli del run" in banner e toast

- **depends_on**: [T33]
- **location**: `src/db/today.ts`, `tests/api-today.test.ts`, `web/src/routes/index.tsx` (sezione Avvisi),
  `web/src/components/JobBanner.tsx`, `web/src/lib/jobs.ts` (`jobOutcomeLinks`), toast d'esito
- **description**: H5: `failed_runs` = per ogni strumento il cui run più recente è fallito **per quello strumento**
  (`failedTools`), una riga per run con gli strumenti coinvolti; in Oggi riga *"Ultimo run fallito per Apollo: …"* +
  **Vedi dettagli**; J14: **Dettagli del run** su ogni esito di banner e toast.
- **validation** (cli): tdd target + un run successivo riuscito toglie l'avviso; un run fallito per Anthropic non
  accende Apify. (browser): avviso in Oggi e link dal banner al dettaglio.
- **status**: Done
- **log**: 2026-09-20. RED→GREEN in `tests/api-today.test.ts`: `failed_runs` = per ogni strumento il suo run più recente, se è fallito **per lui** (`failedTools`), una riga per run (`{tools, run}`) con gli strumenti nell'ordine del catalogo; un run riuscito dopo toglie l'avviso. In Oggi la sezione **Avvisi sugli strumenti** (`today/FailedRunAlerts.tsx`): *"Ultimo run fallito per Apollo: <errore>"* + **Vedi dettagli**. J14: `runDetailLink(job)` in `lib/jobs.ts`, in coda a `jobOutcomeLinks` (quindi su ogni esito, anche a zero) e aggiunto a mano dove i link non passavano di lì — banner del run in corso (la via al log che si aggiorna da solo), banner dei falliti e toast dei falliti. Verificato in browser: due avvisi in Oggi che aprono il dettaglio giusto, "Dettagli del run" nel banner (in corso, completato e fallito) e nel toast di errore. Gate: typecheck, 52 file / 630 test, build e typecheck web.
- **files edited/created**: `src/db/today.ts`, `tests/api-today.test.ts`, `web/src/components/today/FailedRunAlerts.tsx` (nuovo), `web/src/routes/index.tsx`, `web/src/components/JobBanner.tsx`, `web/src/lib/jobs.ts`, `web/src/api/types.ts`
- **backlog_item_id**: PF-S8
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#H. Oggi (home)]]
- **relation_mode**: body-links
- **tdd_target**: Se il run più recente di Apollo è fallito per Apollo, `/api/today` ha una riga in `failed_runs` con
  `tools: ['apollo']`; un run fallito che conta per Apify e Anthropic dà una sola riga con entrambi.
- **review_mode**: mixed
- **assigned_skills**: agent-browser

### T35: Analisi singola come run

- **depends_on**: [T34]
- **location**: `src/server/routes/analyze.ts`, `src/analysis/analyze.ts` (hook prima della prima chiamata),
  `src/server/jobs.ts` (`runningJob`, `getCurrentJob`, riconciliazione all'avvio), `src/db/jobs.ts`,
  `src/server/routes/jobs.ts` (retry e retry-preview → 409 `not_retryable`), `web/src/routes/settings.connections.runs.$runId.tsx`
  (J13), `tests/analyze.test.ts`, `tests/jobs.test.ts`
- **description**: P-13: riga `detached` creata solo se l'analisi chiama uno strumento, eseguita dentro
  `withRunLog`, esito e strumenti come gli altri run; esclusa da job unico, banner, "Riprova"; al riavvio le `detached`
  rimaste `running` diventano `failed`. Dettaglio di un'analisi singola fallita senza Riprova: *"Le analisi singole si
  rilanciano dalla scheda della persona."* + **Apri la scheda di <nome>**.
- **validation**: tdd target + nessun run senza chiamate (non arricchita, stesso input), fallimento attribuito ad
  Anthropic, 409 su retry, riconciliazione dopo riavvio; (browser) J13.
- **status**: Done
- **log**: 2026-09-20. RED→GREEN in `tests/analyze.test.ts` (3 test nuovi). Il logger accetta un run il cui id arriva dopo (`LazyRun`): le righe restano in coda e si scrivono quando la riga nasce, o si buttano se non nasce — così *"Avvio: Analisi singola"* c'è senza creare run per un'analisi saltata. `analyzeProspect` chiama `opts.onToolCall()` **prima** del primo strumento (arricchimento inline e modello); la route apre lì il run con `startDetachedRun` (riga `detached = 1`, pid del server, strumenti `['anthropic']` o `['anthropic','apify']` se arricchisce prima) e lo chiude con `finishDetachedRun` (esito J4: analizzata = completato, rifiuto o profilo senza dati = completato con avvisi, il resto fallito con l'errore attribuito ad `actor:<modello>`). `runningJob`/`getCurrentJob`/`findLatestJob` ignorano i `detached` (niente job unico, niente banner); `retryJob` e `retryPreview` rispondono 409 `not_retryable` con *"Le analisi singole si rilanciano dalla scheda della persona."*; `reconcileRuns()` all'avvio del server chiude i run rimasti `running` (per le analisi singole: *"Analisi singola interrotta dal riavvio del server."*). FE: sul dettaglio di un'analisi singola niente **Riprova…**, ma la frase + **Apri la scheda di <nome>**. Verificato in browser su un'analisi singola fallita (JSON non valido dal modello finto): nessun Riprova, il link alla scheda, *"Conta come fallito per: Anthropic"* anche se il run ha usato pure Apify, log con le due chiamate. Tolto `web/src/components/settings/JobsCard.tsx`, rimasto senza usi dopo T32. Gate: typecheck, 52 file / 633 test, build e typecheck web.
- **files edited/created**: `src/runs/log.ts`, `src/analysis/analyze.ts`, `src/server/routes/analyze.ts`, `src/server/jobs.ts`, `src/server/index.ts`, `src/db/jobs.ts`, `tests/analyze.test.ts`, `web/src/routes/settings.connections.runs.$runId.tsx`, `web/src/components/settings/JobsCard.tsx` (tolto)
- **backlog_item_id**: PF-S10
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#J. Impostazioni e Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: POST `/api/prospects/:id/analyze` con deps finte mentre un job è `running` risponde 200, crea un run
  `detached` completato con log e strumenti `['anthropic']`, e `/api/jobs/current` resta sul job in corso.
- **review_mode**: mixed
- **assigned_skills**: agent-browser

### T36: Smoke M3, documenti e debito

- **depends_on**: [T29, T35]
- **location**: `tests/e2e/smoke-people.md`, `tests/e2e/README.md`, `README.md` (Connessioni, log locali nel DB),
  `AGENTS.md` (`withRunLog`, `toolsOf`/`RUN_TOOLS` nella checklist del job kind), IMPLEMENTATION-NOTES (sezione M3),
  `brain/tech-debt/prospect-crm/crm-foundation.md` (TD-25 e TD-38 chiusi), `brain/log.md`
- **description**: smoke dei percorsi dell'ux-advisor: G.1–G.6 con `FAIL` e `FAIL_ONCE`, enrich-error,
  `E2E_NO_APOLLO`; attribuzione multi-strumento (J4); J13; H5; J14; C.1 completo (esito del sync con "Apri Da smistare" e
  "Dettagli del run"); ricerca delle chiavi finte nei log **e** nei dettagli dei run (J10); righe
  Riprova/Log/Run inesistente; troncamento con `LOG_FLOOD`; run precedente al rilascio. Documenti, debito, chiusura.
- **validation**: smoke senza BLOCKER; 4 gate verdi; TD aggiornati.
- **status**: Done
- **log**: 2026-09-20. Smoke M3 con agent-browser fatto da un agente separato (sessione `smoke-m3`, e2e :8853 + Vite :5203, due riavvii per `E2E_FAKE_DELAY_MS` e `E2E_NO_APOLLO`): G.1–G.6, J1–J15, H5, C.1, righe d'errore di Connessioni/dettaglio/log, `LOG_FLOOD`, run precedente al rilascio, ricerca delle chiavi su 12 run via API → **0 BLOCKER, 1 MAJOR, 8 MINOR** (`tests/e2e/smoke-people.md`, sezione M3). Tutti corretti e ricontrollati nel browser: parametri del run col `kind` (azienda mancante, `force` con le parole del kind giusto), chip neutro *"Fallito per Anthropic"* sulla card di chi non ha fallito, avviso di Oggi con operazione e ora, percorso con "Impostazioni" cliccabile e la data del run, un solo `aria-current` in Impostazioni (la sidebar resta evidenziata senza marcare la pagina), conteggi dell'esito in italiano (`countLabel`), colonna Riassunto ripulita, esito in `role="status"`, `caption` sulla tabella dei run. Passaggio `simplify` (4 revisori: riuso, semplificazione, efficienza, altitudine) sul diff di M3: `redactSecrets` spostata in `runs/tools.ts` (via il ciclo log ⇄ db) e applicata **in scrittura** in `completeJob`/`failIfRunning` (così le chiavi non finiscono neanche in banner e toast), `lastRunPerTool` condivisa da Connessioni e dagli avvisi di Oggi, `withDetachedRun` accanto agli altri run (la route torna a fare la route) con `detachedOutcome`/`toolsOfSingle` nel file del kind, `operationLabel` che legge `detached` invece del parametro inventato `single`, `toolsOf` dell'analisi senza il confronto degli hash (era un `planAnalysis` completo dentro la richiesta d'avvio), `writeRunLine` per la riga finale scritta dal server, `TOOL_LABELS`/`toolNames` e `th`/`td` in un posto solo, `errorText` e `fmtDateTime` duplicati tolti, `RunLog` con un solo stato, `RunParams` con una tabella sola di renderer, `getReadiness` che legge le chiavi dal catalogo degli strumenti, `truncate`/`plural` riusate; skip deliberati elencati nelle notes. Documenti: `AGENTS.md` (checklist del job kind con `toolsOf`/`RUN_TOOLS` e la regola del log), `README.md` (Connessioni, log locali nel DB, `src/runs/`), `tests/e2e/README.md` (run del seed, `LOG_FLOOD`, mappa FLOW G), tech-debt (TD-30 aggiornata: le transazioni nuove usano `.immediate()`, la voce resta aperta), IMPLEMENTATION-NOTES (sezione M3), `brain/log.md`. Gate: typecheck, 52 file / 633 test, build e typecheck web. **Fine di M3 e della spec.**
- **files edited/created**: `tests/e2e/smoke-people.md` (sezione M3 + correzioni), `tests/e2e/README.md`, `README.md`, `AGENTS.md`, `brain/tech-debt/prospect-crm/crm-foundation.md`, `brain/specs/prospect-crm/people-first-crm/IMPLEMENTATION-NOTES.md`, `brain/log.md`; correzioni e `simplify`: `src/runs/{log,tools,outcome}.ts`, `src/db/{runs,jobs,today,settings,schema}.ts`, `src/jobs/{analyze,enrich,enrich-companies,lookalike-companies,apollo-people,sync-interactions,source-company,fake-deps,types}.ts`, `src/server/{jobs,index}.ts`, `src/server/routes/{analyze,runs}.ts`, `web/src/components/runs/{parts,ConnectionCard,RunLog,RunParams}.tsx`, `web/src/components/settings/{parts,ProfileForms}.tsx`, `web/src/components/today/FailedRunAlerts.tsx`, `web/src/routes/{__root,settings.connections.index,settings.connections.$tool,settings.connections.runs.$runId}.tsx`, `web/src/lib/jobs.ts`, `tests/analyze.test.ts`
- **backlog_item_id**: PF-S11
- **backlog_item_url**: [[specs/prospect-crm/people-first-crm/SPEC#K. Coerenza con il dominio]]
- **relation_mode**: body-links
- **tdd_target**: n/a (smoke di tappa, non TDD): verifica = lo smoke M3 percorre FLOW G e gli avvisi H5 senza BLOCKER
  e nessun log né dettaglio di run contiene una chiave.
- **review_mode**: mixed
- **assigned_skills**: agent-browser

## 15. Gate di validazione per tappa

| Tappa | Gate per chiudere | Stop |
|---|---|---|
| M1 (T0–T16) | 4 gate verdi; T2 senza differenze di conteggio né violazioni FK sulla copia reale; smoke M1 senza BLOCKER; A1 e I1 dichiarati parziali (niente Oggi né Cerca, P-22) | `implement-spec` si ferma: riepilogo, cosa provare, numeri di T2, backup al primo avvio. Riparte solo col via dell'utente |
| M2 (T17–T27) | 4 gate verdi; perf test verde; smoke M2 senza BLOCKER; TD-38 chiuso (H1) e TD-25 residuo chiuso lato "Riprova" | Stop come sopra |
| M3 (T28–T36) | 4 gate verdi; smoke M3 senza BLOCKER; nessuna chiave nei log; TD aggiornati | Fine di `implement-spec` (walkthrough `ux-advisor` → `UX-REVIEW.md` come da skill); `adversarial-review` in una **sessione nuova** |

## 16. Questioni aperte (non bloccanti)

| # | Questione | Default del piano |
|---|---|---|
| Q-1 | Promemoria nascosti di Oggi per browser (`localStorage`) o nel DB? | `localStorage` (P-15); si sposta nel DB se l'utente usa più browser |
| Q-2 | Aziende la cui sezione Persone si accorcia con D5 (persone trovate lì ma non collegate) | Solo informate con i numeri di T2; restano visibili nelle Fonti della scheda (Non-Goal della SPEC) |
| Q-3 | `/api/inbox` come alias: quando toglierlo? | Resta finché nessun client lo usa; nessuna azione in questo piano |
| Q-4 | TD-10 (banner che non scopre job avviati altrove) | Fuori scope; il dettaglio run fa polling da sé a run in corso |
