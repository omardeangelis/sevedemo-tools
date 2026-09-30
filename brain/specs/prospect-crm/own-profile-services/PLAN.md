---
domain: prospect-crm
type: plan
spec: own-profile-services
links:
  - "[[specs/prospect-crm/own-profile-services/SPEC|SPEC]]"
  - "[[specs/prospect-crm/own-profile-services/FLOW|FLOW]]"
  - "[[specs/prospect-crm/prospect-crm-specs|prospect-crm-specs]]"
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[specs/prospect-crm/people-first-crm/PLAN|people-first-crm PLAN]]"
created: 2026-09-22
updated: 2026-09-22
---

# PLAN — Profilo e servizi dell'utente da fonti pubbliche (`own-profile-services`)

**Status:** In corso — **M1a (T0–T7) chiusa il 2026-09-29 e committata il 2026-09-30**; M1b (T8–T12) attende il
via dell'utente (§16).
**Execution mode:** `sequential` (P-1). **Cinque tappe** con stop: **M1a** invalidazione (T0–T7) · **M1b**
servizi e campi del profilo (T8–T12) · **M2** l'analisi nomina il servizio affine (T13–T17) · **M3**
Cloudflare quarto strumento (T18–T22) · **M4** generazione e proposta (T23–T33). Ogni tappa chiude con i 4
gate verdi e uno smoke `agent-browser`; `implement-spec` **si ferma alla fine di ogni tappa** e aspetta il via
dell'utente (§16).

> Contratto: [[specs/prospect-crm/own-profile-services/SPEC|SPEC.md]] (91 criteri A1–H7, Constraints, Data
> model) e [[specs/prospect-crm/own-profile-services/FLOW|FLOW.md]] (route, percorsi A–F, error path, edge
> case, testi, accessibilità: **fanno parte della superficie di accettazione**, root `CLAUDE.md`). Dove il
> piano sceglie tra alternative lasciate aperte lo dice nel ledger (§4, decisioni `P-*`, contestabili).
> Le tappe intermedie mostrano **copy provvisoria** rispetto al FLOW: l'elenco completo, con il task che
> ripristina il testo finale, è in §10 — senza quell'elenco il diff di una tappa si legge come una
> violazione del FLOW al momento della review.

---

## 1. Situazione iniziale e findings dal codice

**Git.** Branch corrente `people-first-crm` a `1c2ea85` (M2+M3, T17–T36), **non unito** in `main` (`0967f2f`).
Nel working tree solo modifiche del brain. Il branch di questo piano parte da qui (P-2).

**Cosa il CRM sa dell'utente.** `settings` è chiave/valore (`src/db/schema.ts:263`) e `SETTING_KEYS`
(`src/db/settings.ts:13`) ha **quattro** chiavi: `own_profile_url`, `company_name`, `company_description`,
`company_offering`. `PUT /api/settings` valida uno zod `.strict()` con esattamente quelle
(`src/server/routes/settings.ts:22`). `getReadiness()` espone `profile` (URL presente) e `company`
(`company_description !== null`). Nessuna provenienza, nessun servizio, nessun sito.

**L'impronta dell'analisi — il punto centrale dell'emendamento.**
- `buildAnalysisInput` (`src/analysis/prompt.ts:210-222`) costruisce `system` e `user` e ne fa
  `sha256(system, '\0', user)`.
- La separazione che serve **esiste già**: `systemPrompt` (137-178) ha `<azienda_utente>`, `<icp>`, le aziende
  di riferimento e il blocco "Cosa produrre"; `userPrompt` (180-203) ha `<profilo>`, `<segnali>` e **in coda**
  la frase `Analizza questa persona rispetto all'ICP "<nome>"`. L'impronta della persona si calcola dai due
  blocchi, **non** dalla frase finale: altrimenti rinominare un ICP segnerebbe le analisi e F7 cadrebbe.
- `stale` si calcola in **un punto solo**: `src/server/routes/analyze.ts:144`
  (`latest.input_hash !== analysisInput(ctx).inputHash`). `POST /api/prospects/:id/analyze` restituisce
  invece un `stale: false` **fisso** (`:60`).
- Il salto per input identico **non** è nel job in blocco: è in `analyzeProspect`
  (`src/analysis/analyze.ts:210`), condivisa con l'analisi singola.
- `analysisContext` (`src/analysis/analyze.ts:104`) torna `null` **solo** se la persona non esiste; `analyses`
  ha `ON DELETE CASCADE` su persona e ICP, quindi ogni riga ha entrambi: il backfill dell'impronta può
  sempre calcolare un valore vero (P-4).
- Consumatori di `stale` nel FE: `AnalysisCard.tsx:180` (riga *"Il profilo è cambiato dopo l'analisi."*),
  `:282` (badge ambra in `FitRow`) e `:212` (`variant={latest && !data?.stale ? 'outline' : 'default'}`, la
  **prominenza** del bottone). Il bottone manda già `force: true` quando un'analisi esiste (`:108`); modello e
  data sono già in testata (`:177`); il prezzo dell'hint è scritto a mano (`:230`).
- Tipi: `web/src/api/types.ts:529,540,847,851,855`; `src/db/prospects.ts:602` espone `input_hash`.

**L'analisi in blocco.** `planAnalysis` (`src/jobs/analyze.ts:156`):
`const onlyMissing = params.onlyMissing ?? params.listId !== undefined` — **lista sì, selezione no**. Per chi
ha già un'analisi e non ha `force` (177-193) calcola contesto e hash: uguale → `skipped_same_input`,
diverso → `skipped_analyzed` **solo se** `onlyMissing`, altrimenti in `analyzeTargets` (si paga). Con
`onlyMissing` acceso l'hash si calcola **comunque** (una lettura + uno sha256 a persona) pur non servendo;
`opts.enrichTargetsOnly` esiste già come scorciatoia per `toolsOf`.

**La casella che F8 riusa esiste già.** `AnalyzeDialog` (`web/src/components/IcpPickerDialog.tsx:160-275`):
stato locale `force` passato a preview **e** avvio; label **"Rianalizza anche quelle già fatte"**, descrizione
*"Ricalcola anche le analisi con gli stessi dati: costa di nuovo."* Il `summary` mostra già *"già analizzate
con gli stessi dati (saltate)"* e *"già analizzate (saltate)"*. Esiste anche una prop `onlyMissing` passata
da `web/src/routes/lists.$id.tsx:460`.

**Registry dei job: esaustivo e asserito.** `src/jobs/handlers.ts` ha cinque mappe `Record<JobKind, …>`;
`tests/app-skeleton.test.ts:45-55` asserisce `Object.keys(HANDLERS).sort() === [...JOB_KINDS].sort()` **e** lo
stesso per `REAL_DEPS`, `CONFIG_BLOCKERS` e `JOB_KIND_LABELS`; `tests/jobs.test.ts:610` e
`tests/schema.test.ts:232` iterano `JOB_KINDS`. Quindi un valore nuovo in `JOB_KINDS` **rompe la suite** se non
arrivano insieme le sei voci — ma il repo ha già la convenzione: l'header di `handlers.ts` dice *"pre-cablato
da crm-foundation T3 e da apollo-lookalike T5"* e `NotImplementedError` (`src/jobs/types.ts`) è documentata
come *"Lanciata dagli stub finché il task proprietario non implementa il pezzo"* (P-3).

**Stima dell'analisi.** `config.prices.analysisPerProspectUsd = 0.03` **fisso**, più gli arricchimenti se
`PRICE_PROFILE_DETAIL_USD` è configurato (`estimateAnalysisCostUsd`). Il prezzo compare **due volte**: nella
preview e a mano nell'hint della card (`AnalysisCard.tsx:230`) — è così che ha derivato.

**Post.** `posts.text_excerpt` (`schema.ts:310`); `upsertPost` **tronca** a `EXCERPT_MAX = 300`
(`src/db/posts.ts:34,57`) mentre il mapper passa già il testo integrale. Il prompt dell'analisi tronca a 160
(`prompt.ts:116`), quindi conservare l'integrale **non** muove l'hash. Attenzione: `EXCERPT_MAX = 160` in
`src/apollo/client.ts:45` è un'altra costante (log Apollo).

**Catalogo degli strumenti.** `src/runs/tools.ts`: `TOOL_IDS = ['apify','apollo','anthropic']`, `Tool.env_var`
**singolare**, `redactSecrets` itera `TOOL_IDS` (un segreto è coperto **solo** se il suo strumento è nel
catalogo, A7), `toolNamedBy` (89) attribuisce un `actor:<id>:` senza slash e diverso da `apollo` ad
**Anthropic** quando il run usa Anthropic — che è il caso della generazione, e rompe A6.
`src/server/routes/runs.ts:33` valida `isToolId(tool)` → 404. FE: `Connection.env_var: string`
(`web/src/api/types.ts:947`), reso una volta in `ConnectionCard.tsx`; griglia `lg:grid-cols-3`.

**Apollo per dominio.** `enrichOrganizationsRequest` + `APOLLO_BULK_MAX` (10) + `chunk` in
`src/apollo/requests.ts`, mappato da `mapOrganizations`. C10 riusa la **richiesta**, non il job (B9).

**Actor del profilo.** `ACTORS.profileDetail = 'apimaestro/linkedin-profile-detail'` con
`profileDetailInput([url]) → {username, includeEmail: true}`, mappato da `mapProfileDetailItem`. È l'actor
no-cookie di C3.

**Promemoria di Oggi.** `SETUP_KEYS` (`src/db/today.ts:33`) e `SETUP_ITEMS`
(`web/src/components/SetupReminder.tsx:18`), reso da `SetupAlerts.tsx` con "Nascondi" e firma in
`localStorage`.

**Impostazioni → Profilo e azienda.** `web/src/routes/settings.profile.tsx` = griglia `lg:grid-cols-2` con
`ProfileSection` (Card *"Profilo LinkedIn"*, `form id="profilo"`) e `CompanySection` (Card *"La mia
azienda"*, `form id="azienda"`), con il focus da hash già implementato.

**Migrazioni.** `applySchema` → `migrateSchema` (`planSchemaMigration`, **un** `backupDatabase` per processo,
una transazione con `foreign_key_check`, `rebuildTableSteps` per CHECK/NOT NULL, `ensureColumn` per le
additive) → `exec(SCHEMA)`. `scripts/migration-check.ts` + `npm run db:migration-check` esistono da
`people-first-crm` T2, con l'isolamento dal DB reale (nessun import di `src/db/index.ts`; il sorgente non si
apre mai con SQLite, perché anche un `readonly` su un DB in WAL crea `-wal`/`-shm`).

**Test che toccano l'emendamento.** `tests/analyze.test.ts:717-736` cambia `prospects.about` e attende
`stale: true` — **resta verde** con F13. `tests/api-fits.test.ts:183-191` attende `stale: true` su un'analisi
scritta da un helper: va adeguato l'**helper**, non il criterio.

**Documenti che descrivono il comportamento di oggi** (H7): `README.md:76` (tre motivi di invalidazione),
`README.md:157` (scritture Apollo — **resta vero**), `tests/e2e/README.md:98`,
`brain/domains/prospect-crm/prospect-crm-contract.md:93`,
`brain/specs/prospect-crm/apollo-lookalike/SPEC.md:427-429` (**resta vero**),
`brain/specs/prospect-crm/people-first-crm/SPEC.md:289` (**resta vero**) e i PLAN di `crm-foundation` e
`people-first-crm`.

## 2. Problema

Il CRM non sa cosa l'utente vende: tre righe scritte a mano mesi fa e nessun servizio. E il meccanismo che
avvisa quando un'analisi è vecchia è tarato sull'input intero, quindi appena i servizi entrano nel contesto
**ogni ritocco a un servizio riaccenderebbe l'intero archivio delle analisi**: un invito permanente a una
spesa che nessuno ha chiesto.

## 3. Forma della soluzione

Cinque tappe ordinate per **valore e rischio**, non per numero di criterio.

1. **M1a — invalidazione.** L'unica tappa che **riscrive righe esistenti**: l'impronta spezzata, il badge che
   passa a parlare della persona, l'analisi in blocco che salta sempre chi è già analizzato, il testo
   integrale dei post, i documenti che diventerebbero falsi. Nessuna chiamata esterna, nessuna riga su
   `/settings/profile`. Vale da sola: il rumore del badge sparisce e una selezione non spende più da sé.
2. **M1b — servizi e campi.** La tabella dei servizi col suo CRUD, i campi nuovi del profilo con la
   provenienza, la pagina a una colonna.
3. **M2 — l'analisi nomina il servizio affine.** Con tre servizi scritti a mano l'utente ha il valore che ha
   chiesto, prima che esista qualunque generazione.
4. **M3 — Cloudflare quarto strumento**, con la verifica manuale che l'utente lancia **prima** che un job lo
   usi (A8).
5. **M4 — generazione e proposta.** È qui che la promessa principale della spec — *"non voglio riscrivere
   quello che vendo in sette caselle"* — viene mantenuta.

Perché M1 si spezza in due (`ux-advisor`, §9): M1a è l'unico momento irreversibile sul database reale, e
metterlo nella stessa tappa di un rifacimento di pagina significa mischiare l'unico rischio serio con il
lavoro più visibile. Separate, ognuna ha un gate che la prova.

Tre scelte strutturali che tengono il piano piccolo:
- **Il confronto della proposta si ricalcola a ogni lettura** (edge case del FLOW): la proposta è un blob
  salvato, non una macchina a stati. Nessuno stato "applicata" per voce nel database.
- **La provenienza dei campi del profilo sta in una tabella a parte**, non dentro `settings`: i consumatori
  attuali di `company_description`/`company_offering` non cambiano di una riga (B8).
- **Una sola migrazione sul database reale**, in M1a, col kind di M4 pre-cablato a stub (P-3).

## 4. Decision ledger

### Decisioni di prodotto (SPEC/FLOW, con l'utente)

Vedi `SPEC.md` → Decision Log e `FLOW.md` → Decisioni chiuse. Le dodici del grill di questo piano:

| # | Decisione | Presa |
|---|---|---|
| G-1 | Tappe in ordine: fondamenta → analisi → Cloudflare → generazione (poi spezzate in M1a/M1b, §9) | Utente, 2026-09-22 |
| G-2 | Branch `own-profile-services` da `people-first-crm` (non unito, e G1 estende Impostazioni) | Utente |
| G-3 | `PROFILE_MODEL` con default il valore di `ANALYSIS_MODEL` (OQ-3) | Utente |
| G-4 | Freschezza del proprio profilo = 90 giorni, `FRESHNESS_DAYS` (OQ-1) | Utente |
| G-5 | Impronta spezzata in due: il badge resta solo per i cambi della **persona** (F7, F11, F13) | Utente, su segnalazione del gate |
| G-6 | La casella dell'analisi in blocco è quella esistente, semantica `onlyMissing` invece di `force` (F8) | Utente |
| G-7 | Sito: 10 pagine in `CLOUDFLARE_MAX_PAGES`, percorsi noti (OQ-2) | Utente |
| G-8 | "Tieni il mio" su una voce in conflitto: rinviato (OQ-5) | Utente |
| G-9 | Oggi: due voci, non tre — "descrizione azienda" tace finché la generazione è possibile (OQ-7) | Utente |
| G-10 | Conferma prima di scartare una proposta (OQ-6); card `#profilo` → "I tuoi indirizzi pubblici" (OQ-8) | Utente |
| G-11 | I tre campi dell'azienda già nel database **non** sono "scritti a mano": "Applica tutto" può sostituirli, ma la testata dichiara quanti campi compilati sostituirebbe | Utente, su segnalazione dell'`ux-advisor` |
| G-12 | "Includi chi è già analizzato" con **zero** da rifare è un **blocco**, non un avviso | Utente |

### Decisioni prese in pianificazione (derivate da SPEC/FLOW/codice; contestabili)

| # | Decisione | Perché |
|---|---|---|
| P-1 | `sequential`, un task alla volta | M1a tocca `analyses`, `posts` e il registry in una sola migrazione: task paralleli si pesterebbero sullo schema e su `handlers.ts`, che la regola anti co-edit vieta di co-modificare |
| P-2 | Branch da `people-first-crm@1c2ea85`, non da `main` | G-2. `main` non ha la sezione Impostazioni in tre pagine che G1 estende |
| P-3 | **Una** migrazione sul DB reale (M1a), con `generate_profile` in `JOB_KINDS` già in T1 e il kind **pre-cablato a stub** (`NotImplementedError`) nelle sei voci del registry | `tests/app-skeleton.test.ts:45-55` esige registry completi, quindi il kind non può entrare "nudo". Le alternative erano due ricostruzioni di `jobs` sul DB reale (due backup, due rehearsal) o un kind che arriva tardi: il pre-cablaggio a stub è la convenzione che il repo **già usa** (`handlers.ts`: *"pre-cablato da crm-foundation T3 e da apollo-lookalike T5"*), e la route del kind non esiste fino a M4, quindi lo stub è irraggiungibile. Divergo qui dall'`ux-advisor`, che proponeva due migrazioni |
| P-4 | Il backfill di `analyses.subject_hash` scrive un'impronta **vera per ogni riga**; nessun `NULL` resta dopo la migrazione | `analyses` ha `ON DELETE CASCADE` su persona e ICP, quindi il contesto è sempre risolvibile. Un `NULL` letto come "non scaduta" sarebbe una riga che **non riprende più** il badge dopo un arricchimento: si perderebbe F13 per sempre su quelle analisi. La lettura tratta comunque `NULL` come "non scaduta", per difesa |
| P-5 | `subjectHash` nasce in `buildAnalysisInput` accanto a `inputHash`, dai soli blocchi `<profilo>` e `<segnali>`, estratti in una funzione | Un unico punto conosce la forma del prompt; niente `slice` di testo che si rompe alla prima modifica del prompt |
| P-6 | La frase finale dello user prompt (`Analizza questa persona rispetto all'ICP "X"`) resta **fuori** dall'impronta della persona | Contiene il nome dell'ICP: dentro, rinominare un ICP segnerebbe tutte le analisi e F7 cadrebbe |
| P-7 | `POST /api/prospects/:id/analyze` restituisce il `stale` **vero** invece del `false` fisso | Un campo che mente è peggio di un campo assente; il FE ne ha già il tipo |
| P-8 | Con la casella spenta, `planAnalysis` **non calcola** l'impronta dei già analizzati e li conta tutti sotto `skipped_analyzed` | Oggi paga una lettura + uno sha256 a persona per un conteggio che il FLOW non mostra più, e lo spezzettamento renderebbe falsa la frase *"128 restano fuori"* |
| P-9 | La prop `onlyMissing` di `AnalyzeDialog` resta; cambia il **default del server**, che diventa "salta sempre" | La lista filtrata continua a dire esplicitamente ciò che vuole; il default non dipende più dall'ambito |
| P-10 | Provenienza dei campi del profilo in `profile_field_origin`, non in `settings` | B8: `getSettings`, `PUT /api/settings`, il contesto dell'analisi e gli avvisi di configurazione non cambiano di una riga |
| P-11 | Le fonti lette stanno in `profile_sources` (una riga per fonte) | C4, C13 e G5 leggono la stessa riga; il record Apollo è la riga della sua fonte (C10), non un'azienda (B9) |
| P-12 | La proposta è **una riga** in `profile_proposals` con campi e servizi in JSON; nessuno stato "applicata" per voce | Il FLOW dice che il confronto si ricalcola a ogni lettura: uno stato per voce sarebbe una seconda verità che si disallinea |
| P-13 | `Tool.env_var: string` → `env_vars: string[]`, con il segreto da redigere dichiarato a parte | Cloudflare ha due variabili e **una sola** è un segreto (A7) |
| P-14 | Gli errori Cloudflare usano il prefisso `actor:cloudflare:<op>:` | `toolNamedBy` riconosce già `apollo` per nome e gli slash come Apify: un id dedicato entra nella stessa logica invece di ricadere su Anthropic (A6) |
| P-15 | La verifica manuale è `npm run cloudflare:smoke`, documentata nel README come `apollo:smoke` | A8 chiede lo stesso precedente; la lancia l'utente, non l'agente |
| P-16 | L'esito per fonte vive in `jobs.result.counts` + `profile_sources`, non in una tabella nuova | L'esito di un run è già un fatto del run; la card lo rilegge dalle righe delle fonti (G5) |
| P-17 | Il servizio affine sono due colonne di `analyses` (`best_service_name`, `best_service_reason`), testo, nullable | F4 (nome di allora) e F5 (eliminare o rinominare non riscrive il passato) |
| P-18 | La stima dell'analisi diventa **una** funzione condivisa da preview e hint della card, in **M2** | Il prezzo è scritto due volte (preview + `AnalysisCard.tsx:230`): è così che ha derivato. M1a **non tocca** i testi di costo, anche se cambia i conteggi che li alimentano (§9) |
| P-19 | I documenti si aggiornano nella tappa che li rende falsi: H7 in M1a, H2 in M3, H1 e `PROFILE_MODEL` in M4 | Un README che descrive il comportamento vecchio per quattro tappe è documentazione falsa; all'ingest resta solo il livello di dominio |
| P-20 | Il reset una tantum del badge si dichiara in **tre** posti: `README.md`, una riga di console della migrazione, e il messaggio di consegna della tappa M1a | F6 e i Constraints chiedono che sia detto, il FLOW non nomina la superficie (§9). Nessuna delle tre da sola raggiunge l'utente al momento giusto |
| P-21 | La lettura unica di B7 nasce **già con le chiavi di M4** (proposta pendente, data e modello dell'ultima generazione), a `null` finché M4 non le riempie | Così M4 aggiunge card alla pagina senza rifarne il flusso di dati |
| P-22 | M3 **non ha** uno smoke e2e proprio: A5 e A6 si verificano in M4, dove esiste un run di Cloudflare che può fallire | Meglio dichiararlo che gonfiare M3 per farla sembrare completa |
| P-23 | L'unicità di B10 poggia su una colonna `services.name_key` scritta dall'applicazione con **un solo** normalizzatore, non su un indice su espressione | `lower()` di SQLite piega solo l'ASCII (§7): con un indice su espressione `QUALITÀ` e `Qualità` non collidono, e i nomi di servizio in italiano hanno accenti. Una colonna scritta dall'app è anche l'unico modo perché API e database **non possano** divergere: l'indice vede esattamente ciò che ha scritto il normalizzatore |
| P-24 | Il marcatore di C6 si deriva dalla forma vera di `truncate` (`length = 301 AND` ultimo carattere `…`), non da `length = EXCERPT_MAX` | `truncate` aggiunge i puntini di sospensione: un estratto troncato è lungo 301. La condizione `= 300` non corrisponderebbe a **nessun** post, marcando integrale ogni post troncato — che T23 darebbe poi al modello come fonte completa, esattamente ciò che C7 e C8 esistono per evitare. Trovato dal gate sul piano |
| P-25 | Il backfill dell'impronta vive in un modulo suo (`src/db/subject-hash.ts`), chiamato da `src/server/index.ts` all'avvio, e riusa la **stessa** funzione di caricamento della persona del percorso a runtime | Non può stare in `schema.ts`: servirebbe `loadAnalysisSubject`, che importa `db/index.js`, che importa `schema.ts` — un ciclo, e romperebbe l'isolamento dichiarato di `scripts/migration-check.ts`, che T2 deve tenere verde. Il precedente del repo è `fillMissingRunTools` (puro, chiamato da `src/server/index.ts:13`, idempotente e silenzioso). E riusare la stessa funzione è l'unico modo perché l'impronta del backfill combaci **byte per byte** con quella del runtime: duplicare la query marcherebbe da aggiornare ogni analisi al rilascio, l'opposto di F6 |
| P-26 | L'attribuzione si estende: un run **riuscito** che ha una fonte fallita conta come fallito **per lo strumento di quella fonte** | A6 chiede che l'errore di Cloudflare compaia nella sua card e negli avvisi, ma C12 tiene le fonti isolate, quindi quel run non fallisce e `failedTools` (che guarda solo `state === 'failed'`) restituirebbe sempre l'insieme vuoto. Senza questa aggiunta A6 non è raggiungibile da nessun flusso che la spec permetta, e il gate di M4 sarebbe impossibile da chiudere. Non cambia C12: il run resta riuscito, cambia solo chi conta come "fallito per" |
| P-27 | La stima dell'analisi resta un **prezzo per persona**, reso configurabile (`PRICE_ANALYSIS_USD`, default l'attuale 0,03), **non** un modello a token | F10 chiede che la stima sia dichiarata, non che sia proporzionale all'input; un modello a token sarebbe una stima più precisa e molto più cosa da mantenere. Il difetto vero è la **triplicazione**: oggi il prezzo è scritto a mano tre volte nell'hint della card (`AnalysisCard.tsx:228, 230, 231`) oltre che nella preview, ed è da lì che ha derivato. T15 toglie la triplicazione e rende il numero configurabile |
| P-28 | Gli avvisi che nominano una fonte vivono **solo** nella lista strutturata delle fonti della preview; `warnings` porta solo quelli che non appartengono a una fonte | FLOW B.3 chiede "ogni avviso una volta sola". Metterli in entrambi e deduplicare con un confronto di stringhe nel FE è fragile: la regola sta nel contratto dell'API, non nella resa |

## 5. Assunzioni e vincoli

- **Mai chiamare Apify, Anthropic, Apollo o Cloudflare** dai test o dalla validazione (root `AGENTS.md`).
  `apollo:smoke` e il nuovo `cloudflare:smoke` li lancia **l'utente**: spendono.
- **`data/crm.db` non si tocca.** Test ed e2e usano DB temporanei; `db:migration-check` lavora su una copia e
  non apre mai il sorgente con SQLite.
- **Server e Vite si fermano per PID**, mai `pkill -f` su un pattern condiviso, e mai durante un job.
- **Un solo job alla volta**, anteprima obbligatoria anche nel retry, esito attribuito, segreti sempre
  redatti.
- **`app.ts` e `handlers.ts` sono pre-cablati**: la logica non ci va e i task non li co-modificano.
- **UI, commenti e messaggi in italiano** (G8, E13): è un criterio trasversale, non di un task — ogni smoke
  di tappa lo verifica sui testi che quella tappa introduce, e nessun task ne è esentato.
- **Assunzione sul DB reale** (F6, non verificabile senza aprirlo): nome, descrizione e offerta dell'azienda
  sono valorizzati, i campi nuovi no, non esistono servizi. Se fosse falsa, T2 lo scopre sui conteggi della
  copia prima di qualunque scrittura sul DB vero.
- **Assunzione su Cloudflare**: nomi di prodotto, percorsi di documentazione, limiti di piano e forma
  dell'endpoint di crawl citati nella SPEC vanno **riconfermati da T20** prima di diventare vincoli.

## 6. Modello dati (delta DDL, tutto in T1)

```sql
-- Servizi (B2, B4, B6, B10): nome obbligatorio, unico a meno di maiuscole e spazi; ordine dell'utente.
CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  -- B10: chiave normalizzata scritta dall'**applicazione** (P-23), non un indice su espressione:
  -- `lower()` di SQLite piega solo l'ASCII, quindi `QUALITÀ` e `Qualità` non colliderebbero.
  name_key    TEXT NOT NULL,
  description TEXT,
  audience    TEXT,          -- a chi serve
  problem     TEXT,          -- problema che risolve
  proof       TEXT,          -- prove e risultati
  notes       TEXT,
  position    INTEGER NOT NULL,
  origin      TEXT NOT NULL CHECK (origin IN ('manual', 'proposal')),
  origin_at   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT <NOW>
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_services_name_key ON services(name_key);
CREATE INDEX IF NOT EXISTS idx_services_position ON services(position);

-- Provenienza dei campi del profilo (B6), fuori da `settings` per non toccarne i consumatori (P-10).
-- Nessuna riga = nessuna provenienza: è il caso dei tre campi già nel database (G-11).
CREATE TABLE IF NOT EXISTS profile_field_origin (
  field     TEXT PRIMARY KEY,
  origin    TEXT NOT NULL CHECK (origin IN ('manual', 'proposal')),
  origin_at TEXT NOT NULL
);

-- Fonti pubbliche lette (C4, C13, G5, C10): una riga per fonte, l'ultima lettura.
CREATE TABLE IF NOT EXISTS profile_sources (
  kind     TEXT PRIMARY KEY CHECK (kind IN ('linkedin', 'website', 'posts', 'apollo')),
  read_at  TEXT NOT NULL,
  outcome  TEXT NOT NULL CHECK (outcome IN ('read', 'empty', 'failed', 'unavailable')),
  reason   TEXT,                                  -- motivo di "non letta" (C13)
  content  TEXT,                                  -- testo per l'elaborazione; per `apollo` il record grezzo
  meta     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);

-- Una sola proposta pendente (E11), blob: il confronto si ricalcola a ogni lettura (P-12).
CREATE TABLE IF NOT EXISTS profile_proposals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  model      TEXT NOT NULL,
  fields     TEXT NOT NULL CHECK (json_valid(fields)),    -- {campo: {value, sources[]}}
  services   TEXT NOT NULL CHECK (json_valid(services)),  -- [{name, …, sources[]}]
  sources    TEXT NOT NULL CHECK (json_valid(sources)),   -- esito per fonte al momento della generazione
  discarded  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(discarded)), -- conteggi di E6
  created_at TEXT NOT NULL DEFAULT <NOW>
);

-- Additive, senza ricostruzione (`ensureColumn`):
ALTER TABLE analyses ADD COLUMN subject_hash        TEXT;     -- F11, P-4 (riempita dal backfill di T3)
ALTER TABLE analyses ADD COLUMN best_service_name   TEXT;     -- F2, F4 (scritta da M2)
ALTER TABLE analyses ADD COLUMN best_service_reason TEXT;     -- F2 (scritta da M2)
ALTER TABLE posts    ADD COLUMN text_complete       INTEGER;  -- C6: 1 integrale, 0 troncato
```

`<NOW>` = la stessa espressione di default già usata dallo `SCHEMA` esistente.

**Ricostruzione** (CHECK cambiato): `jobs`, per `generate_profile` in `JOB_KINDS` — **una sola volta**, in
M1a (P-3).
**Backfill**: `posts.text_complete` (C6) nella transazione di T1, con la condizione derivata dalla **forma
vera** prodotta da `truncate` e non dalla costante — `length(text_excerpt) = 301 AND substr(text_excerpt, -1)
= '…'` ⇒ `0` (troncato), altrimenti `1` (P-24). `analyses.subject_hash` in T3, che è dove esiste il prompt
(P-25).

**Chiavi nuove di `settings`** (nessuna DDL): `website_url`, `positioning`, `proof_points`,
`tone_of_voice`. **Campi generabili** = `company_name`, `company_description`, `company_offering`,
`positioning`, `proof_points`, `tone_of_voice`; **input mai proposti** = `own_profile_url`, `website_url` (E2).

**Config nuova**: `PROFILE_MODEL` (default `ANALYSIS_MODEL`, G-3), `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_MAX_PAGES` (default 10, G-7), `PRICE_PROFILE_GENERATION_USD` e
`PRICE_ANALYSIS_USD` (opzionali, `null` = stima non disponibile; il secondo rende configurabile il prezzo per
persona che oggi è una costante nel codice, P-27).

## 7. Ricerca esterna usata

- **Cloudflare Browser Run** — endpoint di crawl, prezzi e limiti (letti il 2026-09-20, citati nella SPEC:
  gratuito 10 minuti di browser al giorno e 3 sessioni; Workers a pagamento 10 ore al mese incluse, $0,09/ora
  oltre). **Da riconfermare in T20** prima di scrivere il client: è il precedente di Apollo, dove uno smoke
  reale ha corretto i limiti assunti.
- **Apollo `organizations/bulk_enrich`** — già integrato e validato dallo smoke del 2026-09-17. Nessuna
  ricerca nuova.
- **Anthropic structured outputs** — già in uso (`ANALYSIS_JSON_SCHEMA`, keyword non supportate filtrate da
  `toStructuredOutputSchema`): la proposta riusa lo stesso meccanismo.
- **SQLite, `lower()` e accenti** — verificato in locale: `lower(replace(…, ' ', ''))` piega maiuscole e spazi
  ASCII (`Assessment  architetturale` collide con `assessment architetturale`) ma **non** gli accenti
  (`QUALITÀ` e `Qualità` non collidono), perché `lower()` di SQLite è ASCII-only. Da qui la chiave normalizzata
  scritta dall'applicazione (P-23) invece di un indice su espressione. La prima stesura di questo piano
  dichiarava "verificato, non un'assunzione" avendo provato **solo** l'ASCII: la correzione arriva dal gate.
- **`truncate` e la lunghezza salvata** — verificato in locale: `truncate(s, 300)` restituisce
  `s.slice(0, 300) + '…'`, cioè **301** caratteri, e `length()` di SQLite li conta 301. Da qui P-24.

## 8. Grafo delle dipendenze e ordine di esecuzione

```
M1a  T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 ⏹
M1b  T8 → T9 → T10 → T11 → T12 ⏹
M2   T13 → T14 → T15 → T16 → T17 ⏹
M3   T18 → T19 → T20 → T21 → T22 ⏹
M4   T23 → T24 → T25 → T26 → T27 → T28 → T29 → T30 → T31 → T32 → T33 ⏹
```

Vincoli di ordine che non sono "il numero successivo":

| Vincolo | Perché |
|---|---|
| T1 prima di tutto il codice | Una sola migrazione (P-3): ogni task dopo trova lo schema definitivo |
| T2 subito dopo T1, prima di qualunque altra scrittura | La migrazione si prova su una copia del DB reale prima di toccare il vero (Constraints) |
| **M1a intera prima di M2** | Dipendenza dura: M2 allarga l'input dell'analisi (F1), e con l'impronta di oggi quel solo deploy marcherebbe **ogni** analisi salvata — la spesa involontaria che F7 esiste per abolire |
| T3 API **e** i suoi tre consumatori FE nello stesso task | Altrimenti F7 è vero nell'API e falso sullo schermo |
| T4 casella, default e due conteggi nello stesso task | Etichetta e semantica che si muovono in tempi diversi = un clic da 128 analisi a costo reale |
| T5 (C7 e C15 insieme) il più presto possibile | C9 vieta il recupero retroattivo: il testo integrale si accumula solo **dal rilascio**. E senza C15 i post interi trapelano in tre viste |
| T6 (seed e2e) prima di ogni smoke successivo | Ogni walkthrough legge lo stato del badge da quel seed |
| T9 (lettura unica) prima di T10/T11, già con le chiavi di M4 | P-21: M4 aggiunge card, non rifà il flusso di dati della pagina |
| T10: vuoto → aggiungi (con i due errori) → riordino → **elimina con la sua conferma** | Lo stato del primo giorno è zero servizi; il nome duplicato è il primo errore che si incontra; l'eliminazione non si separa mai dalla conferma (G7) |
| T13 (F2 condizionale) prima di T14 | Il caso neutro — zero servizi ⇒ input identico a oggi — è ciò che rende vero F6 sul DB reale |
| T14 casi degradati prima del caso felice | Sul DB reale **ogni** analisi è anteriore al rilascio: F9/F3 è la normalità, non l'eccezione |
| T18 (catalogo + redazione) prima di T20 (client) | `redactSecrets` itera il catalogo: un token che arriva a una riga di log non si può più togliere (A7) |
| T21 (A6) prima di M4 | Oggi un errore `actor:<id>:` senza slash va ad Anthropic quando il run lo usa: senza questo la card di Cloudflare non diventerebbe mai rossa |
| T20 (verifica manuale) prima di T23 (lettura del sito) | A8; e OQ-2 (tetto e percorsi) e le parole del limite di piano sono scritte **testualmente** nell'anteprima e nell'esito |
| T24 (blocker, Non disponibili, esito neutro) prima del caso felice | *"Pronte 2 fonti su 4"* è lo stato del primo giorno (FLOW A.2) |
| T25 "stima non disponibile" prima del prezzo | D5: mai un numero inventato, e il `.env` reale può non avere le variabili di prezzo |
| T27 (sola lettura della proposta) prima di T28 (apply) | Nessuna versione di "Applica tutto" deve mai poter toccare un valore scritto a mano |
| T28: singolo apply prima di "Applica tutto"; E11 e "servizio eliminato nel frattempo" nello stesso task | Il confronto si ricalcola a ogni lettura, quindi la corsa è raggiungibile al primo uso con due tab |
| T32 (Oggi, G6 + OQ-7) **in M4** | Prima, l'ancora `#genera` non esiste: un vicolo cieco, e la voce `company` sparirebbe senza niente in cambio |

## 9. Ordine consigliato dall'`ux-advisor` (2026-09-22) — recepito

Il pass ha confermato la costrizione portante (M1a prima di M2) e trovato due difetti reali nel piano.
**Recepito:**

- **M1 spezzata in M1a + M1b**, con stop proprio. M1a è l'unica tappa che riscrive righe esistenti: non deve
  condividere il rilascio con un rifacimento di pagina (§3).
- **G6 e OQ-7 fuori da M1**, in M4 (T32): prima, `#genera` non esiste.
- **L'impronta e i suoi tre consumatori FE in un task solo** (T3), e **casella + default + conteggi** in un
  altro (T4).
- **C7 e C15 atomici** (T5), e presto, perché C9 vieta il recupero retroattivo.
- **Il backfill scrive un'impronta vera per ogni riga**, nessun `NULL` (P-4): un `NULL` letto come "non
  scaduta" sarebbe una riga che non riprende **più** il badge.
- **La stima dell'analisi a M2, da una funzione sola** (P-18); M1a non tocca i testi di costo, anche se cambia
  i conteggi che li alimentano.
- **I documenti nella tappa che li rende falsi** (P-19): H7 in M1a, H2 in M3, H1 e `PROFILE_MODEL` in M4.
- **Il reset del badge si dichiara in tre posti** (P-20): il FLOW chiede che sia detto e non nomina la
  superficie.
- **Lo smoke di F.6 diventa due smoke**: *"nessuna riga del servizio"* è F9 (M2), *"il badge ricompare col
  testo nuovo"* è F13 (M1a). Altrimenti M1a risulterebbe bocciata su un controllo che non può soddisfare.
- **M3 senza smoke e2e proprio** (P-22): A5 e A6 si verificano in M4, dove esiste un run che può fallire.
- **Copy provvisoria dichiarata** (§10).
- **La persona, detta onestamente**: M1a serve solo il *giro successivo* (protettivo, ansioso sul costo);
  M1b/M2 servono il bisogno giusto ma per la strada che la persona rifiuta (*"non voglio riscriverlo in sette
  caselle"*); M3 non serve nessuno dei due. **Il primo giro — la promessa principale della spec — lo serve
  solo M4.** Conseguenza operativa: il dialog dei servizi di M1b resta al minimo di B2 (solo il nome
  obbligatorio); ogni campo o validazione in più è investimento sul ponte, non sulla destinazione.

**Non recepito, con motivo:** due migrazioni sul DB reale invece del kind pre-cablato a stub. Il repo ha già
la convenzione del pre-cablaggio (`handlers.ts`, `NotImplementedError`) e la route del kind non esiste fino a
M4, quindi lo stub è irraggiungibile; due ricostruzioni di `jobs` sarebbero due backup e due rehearsal sul
database vero per evitare venti righe di stub (P-3).

**Portato all'utente e deciso da lui:** la provenienza dei tre campi già nel database (G-11) e il
comportamento con zero da rifare (G-12).

## 9b. Gate `adversarial-verifier` sul piano (2026-09-22) — DO NOT SHIP, assorbito

Il gate ha verificato una quarantina di affermazioni su codice esistente (quasi tutte confermate: registry
esaustivi, CASCADE di `analyses`, separazione system/user del prompt, punto unico di `stale`, default di
`onlyMissing`, catalogo degli strumenti, costanti dei post) e ha bocciato il piano su due difetti
disqualificanti più sette maggiori. Tutti assorbiti, **nessuno ignorato**:

- **[BLOCKER] La condizione del marcatore dei post era aritmeticamente sbagliata.** `truncate` aggiunge i
  puntini di sospensione: un estratto troncato è lungo **301**, non 300, quindi `length = 300` non
  corrispondeva a nessun post e ogni post troncato sarebbe finito nel modello marcato come integrale —
  esattamente ciò che C7 e C8 esistono per evitare. Peggio: la validazione del task era costruita sulla stessa
  premessa (una riga scritta a mano da 300 caratteri), quindi avrebbe riportato verde. Verificato in locale.
  → P-24, §6, T1 (la fixture ora è l'**output di `upsertPost`**, non una riga fatta a mano).
- **[BLOCKER] L'unica scrittura su righe esistenti non era mai provata sul database reale.** T2 è la sola
  prova sulla copia, ma gira **prima** che il backfill esista, e la sua stessa validazione asserisce che la
  colonna è ancora `NULL`; il cancello di M1a citava solo i numeri di T2. → seconda prova in T3 e riga nel
  cancello di M1a (§16).
- **[MAJOR] A6 non era raggiungibile.** Le fonti sono isolate (C12), quindi una generazione col sito non letto
  **riesce**, e l'attribuzione guarda solo i run falliti: la card di Cloudflare non sarebbe mai diventata
  rossa, e il cancello di M4 era impossibile da chiudere. → P-26, T21, T19, T33.
- **[MAJOR] G-11 derogava a E8/H5 senza dichiararlo.** La decisione è dell'utente, ma il piano la applicava di
  soppiatto e §12 dichiarava mitigato un rischio che per quei tre campi non lo è. → nuovi criteri **E14** e
  **H8** nella SPEC, riga del Decision Log, copy condizionale in FLOW A.5, e la riga di §12 corretta.
- **[MAJOR] La validazione della stima non era soddisfacibile.** `analysisPerProspectUsd` è una costante nel
  codice, non una variabile d'ambiente, e il prezzo è scritto a mano **tre** volte nella card, non due. → P-27,
  `PRICE_ANALYSIS_USD`, T15 riscritto su tutti e tre i rami.
- **[MAJOR] B9 non aveva un task** che ne costruisse la superficie, né una verifica dell'invariante. → T30
  (pannello in sola lettura coi testi del FLOW), T9 (il record nella lettura unica), T23 (`companies`
  invariate).
- **[MAJOR] Un Constraint aveva copertura zero**: "scopo dichiarato al servizio" e rispetto dei limiti che il
  sito espone. → T20 (accertato dalla verifica manuale e documentato) e T23 (passato nella richiesta).
- **[MAJOR] L'indice unico di B10 era ASCII-only.** `lower()` di SQLite non piega gli accenti: `QUALITÀ` e
  `Qualità` non collidevano, e la §7 dichiarava "verificato" avendo provato solo l'ASCII. → P-23, colonna
  `name_key` scritta dall'applicazione, prova con la coppia accentata in T1 e T8.
- **[MAJOR] Il backfill non poteva stare dove il piano lo metteva.** In `schema.ts` avrebbe creato un ciclo con
  `db/index.ts` e rotto l'isolamento di `migration-check`, che T2 deve tenere verde. → P-25, modulo proprio
  chiamato da `src/server/index.ts`, che riusa la **stessa** funzione del runtime.
- **Minori assorbiti**: messaggi degli stub distinti tra deps finte e reali
  (`tests/jobs.test.ts:606-627`, altrimenti `npm test` rosso); `app.ts` mancante dalle location di T9 e
  `settings.ts` da quelle di T32; freschezza legata all'**indirizzo** e non al tipo di fonte; le superfici di
  C15 erano cinque e la lista ne sbagliava una (`MergeDialog` non contiene estratti); contratto degli avvisi
  per fonte (P-28); precedenza tra la prop `onlyMissing` e la casella; il blocco di G-12 esteso al caso a
  casella spenta e con il motivo giusto; il rischio che dopo una modifica al profilo "input identico" non
  esista più (§12); F13 che attribuiva il cambio a un gesto che il CRM non conosce; i rami del FLOW senza
  validazione (proposta povera, applica fallito, riordino fallito, scarto fallito, caricamento fallito, banner
  ricostruito, nome del servizio scritto diversamente).

## 10. Copy provvisoria nelle tappe intermedie

Ogni riga è un testo che nella sua tappa **non** è quello del FLOW, col task che lo porta a destinazione.

| Dove | Nella tappa | Testo finale | Ripristinato da |
|---|---|---|---|
| `#servizi` vuoto (FLOW D.1) | *"Nessun servizio. Aggiungine uno a mano."* + **Aggiungi servizio** | + *"o generalo dalle tue fonti pubbliche"* + **Genera profilo e servizi…** | T30 |
| `#servizi`, hint dell'ordine (D.1) | *"Cosa vendi, un servizio per riga. L'ordine lo decidi tu."* | + *"l'analisi e (in futuro) l'assistente ICP li leggono così"* | T16 |
| `#azienda`, hint dei campi nuovi | *"Tutti facoltativi."* | *"Usati dall'analisi AI e (in futuro) dall'assistente ICP. Tutti facoltativi."* | T16 |
| `#profilo`, campo Sito | Etichetta e hint neutri (il campo serve già a M3 e M4) | *"Da qui il CRM legge: non vengono mai proposti."* + la nota C11 sul record d'impresa | T30 |
| Conferma di eliminazione di un servizio (D.4) | Versione breve, senza la frase su F5 | + *"Le analisi che lo citano restano come sono e continueranno a mostrare questo nome."* | T16 |
| Hint di **Rianalizza** (FLOW F.4) | Resta quello di oggi, senza prezzo riscritto a mano | *"Rianalizza con il profilo e i servizi di oggi (≈ …)"*, dalla funzione condivisa | T15 |
| Elenco "Da completare" di Oggi | Invariato (tre voci come oggi) | Due voci, con *"genera profilo e servizi"* e senza *"descrizione della tua azienda"* | T32 |

**Nessuna CTA disabilitata come segnaposto**: G3/G4 e la convenzione di `apollo-lookalike` dicono "CTA sempre
attiva, blocco nel dialog", quindi un bottone di generazione grigio inventerebbe uno stato che il FLOW non
ha. Finché il bottone non esiste, non esiste.

## 11. Strategia di test

- **Server = vitest, tracer bullet RED→GREEN per task.** Import dinamici (`await import()`) per i moduli che
  toccano DB/config; HTTP con `createApp().request()`; interfacce pubbliche, non interni.
- **Job**: funzioni pure con `deps` iniettate; per `generate_profile` quattro deps (profilo, sito, post,
  record Apollo) + il client del modello, ognuna con la sua fixture in `tests/fixtures/profile/`.
- **Nessuna chiamata reale**: le fixture coprono anche i fallimenti (Cloudflare 401, limite di piano, sito
  senza contenuto, dominio sconosciuto, risposta non conforme).
- **Migrazione**: `tests/schema.test.ts` con una fixture `schema-people-first-crm.sql` (DDL di `1c2ea85`
  salvata **prima** di cambiare lo schema) + DB sintetico con dati su ogni tabella.
- **Frontend = nessun runner**: `npm --prefix web run build` + `typecheck` + `agent-browser` contro il server
  e2e (`UI_PORT=<porta> npm run e2e:server`, `E2E_FAKE_JOBS=1`, DB temporaneo per porta) con Vite su porta
  dedicata (`--strictPort`). Sessioni fermate per PID.
- **Superficie di accettazione del FLOW**: gli smoke di tappa verificano i **testi** esatti (quelli di §10
  nella loro versione provvisoria), gli error path, gli edge case e l'accessibilità (focus dopo ogni
  applicazione, `aria-expanded`, `fieldset`/`legend`, `caption`, stati mai solo a colore).

## 12. Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| **La migrazione sul DB reale perde dati** (ricostruzione di `jobs` + 4 colonne + 4 tabelle + 2 backfill) | T2 su una copia, conteggi per ogni tabella e `foreign_key_check`, prima di toccare il vero; un solo backup; T1 idempotente (secondo `applySchema` = no-op). Una sola migrazione in tutto il piano (P-3) |
| **L'impronta della persona segna troppo o troppo poco** | T3 è un tracer bullet con le prove opposte: azienda/ICP **non** segnano, About **sì**, e il rename dell'ICP non segna (P-6) |
| **Il rilascio azzera badge che l'utente si aspettava** (F6) | Dichiarato in tre posti (P-20) e provato dallo smoke di M1a: il badge sparisce, si arricchisce una di quelle persone, il badge ricompare col testo nuovo |
| **La casella riusata cambia semantica sotto le dita** | Label, descrizione, default e i due conteggi nello stesso task (T4); lo smoke li verifica prima dell'avvio |
| **M2 rianima l'archivio delle analisi** allargando l'input | M1a intera è una dipendenza dura di M2 (§8), e T13 ripete la prova di regressione di F7 per una modifica di **servizio**, che M1a non poteva coprire |
| **Cloudflare costa o limita più del previsto** | T20 è una verifica manuale dell'utente **prima** del client; il sito è una fonte facoltativa |
| **L'errore di Cloudflare viene attribuito ad Anthropic** (A6) | P-14 + test puro su `failedTools` con un run a quattro strumenti, in T21, prima che M4 possa fallire |
| **Il token Cloudflare finisce in un log** (A7) | T18 mette Cloudflare nel catalogo **prima** del client (T20): `redactSecrets` itera il catalogo |
| **"Applica tutto" porta via parole scritte dall'utente** | Per i valori con provenienza: T27 (sola lettura) prima di T28 (apply), nessuna versione intermedia può toccarli, e la provenienza si scrive da T9 — **prima** che esista un apply. Per i **tre campi già nel database** la mitigazione non c'è e non può esserci, perché la provenienza non esiste: è la deroga dichiarata in E14/H8, e il presidio è la frase della testata (T31) che dice quanti campi compilati verrebbero sostituiti, più il valore attuale mostrato sopra ogni proposta |
| **Dopo una modifica al profilo, "input identico" non esiste più** | Profilo e servizi stanno nel **system** prompt, quindi un loro ritocco muove l'impronta dell'input intero per **tutte** le persone: il gruppo *"Input identico, saltate comunque"* va a 0 proprio quando l'utente ha appena modificato qualcosa, e spuntare la casella ripaga l'archivio. Mitigazione: la descrizione della casella **non promette** nulla (rimanda all'anteprima, FLOW "Testi che cambiano"), e i due gruppi nell'anteprima mostrano i numeri veri prima dell'avvio. Non è un difetto da nascondere: è il motivo per cui la casella è spenta di default |
| **La freschezza salta la lettura di un indirizzo diverso** | `profile_sources` ha una riga per *tipo* di fonte: cambiando il proprio URL o il sito, *"già letto il 18 set"* resterebbe valido per un indirizzo che nessuno ha mai letto. T23 tiene l'indirizzo letto in `meta` e la freschezza confronta **anche** quello |
| **A6 non sarebbe raggiungibile** | Un run con una fonte fallita resta riuscito (C12), e l'attribuzione di oggi guarda solo i run falliti: la card di Cloudflare non diventerebbe mai rossa. P-26 estende l'attribuzione ai fallimenti per fonte; T21 la implementa e T33 la verifica sul vivo |
| **La proposta inventa valori** (E6) | D14 (modello non chiamato senza contenuto) + validazione strutturata + scarto delle voci senza fonte, contate nell'esito |
| **Il testo integrale dei post trapela in viste brevi** (C15) | T5 taglia dove si mostra (corpo e `title` della card, anteprima di unione, etichetta della fonte); smoke su tutte e tre |
| **`people-first-crm` viene unito in `main` durante il lavoro** | Il branch parte da `1c2ea85`: un merge di `main` si fa a tappa chiusa, non a metà |

## 13. Contratto API (delta)

| Metodo | Path | Note |
|---|---|---|
| `GET` | `/api/profile` | **B7**, già con le chiavi di M4 a `null` (P-21): profilo, servizi in ordine, provenienza per voce, esito per fonte, data e modello dell'ultima generazione, proposta pendente, record d'impresa Apollo (sola lettura, B9), conteggio dei campi compilati senza provenienza (E14) |
| `PUT` | `/api/settings` | Le 4 chiavi di oggi + `website_url`, `positioning`, `proof_points`, `tone_of_voice`; scrivere a mano marca `origin='manual'` |
| `GET·POST` | `/api/services` | Elenco in ordine · creazione (409 `service_exists` sul nome normalizzato) |
| `PATCH·DELETE` | `/api/services/:id` | Modifica (409 sul nome) · eliminazione |
| `PUT` | `/api/services/order` | Ordine dichiarato dall'utente (B4) |
| `GET` | `/api/profile/generate/preview` | Anteprima uniforme + fonti disponibili/non disponibili con motivo, costo per fonte, `model` |
| `POST` | `/api/profile/generate` | 202 `{job}`; 400 `code:'blocked'`; 409 `code:'job_running'` |
| `GET·DELETE` | `/api/profile/proposal` | Proposta col confronto **ricalcolato adesso** · scarto (E12) |
| `POST` | `/api/profile/proposal/apply` | Una voce (`{field}` o `{service}`) oppure `{all: true}` (E7, E8, E9) |
| `GET` | `/api/prospects/:id/analyses` | `stale` dall'impronta della **persona**; `best_service_name`/`_reason` in `latest` e nello storico |
| `POST` | `/api/prospects/:id/analyze` | `stale` **vero** invece del `false` fisso (P-7) |
| `GET` | `/api/analyze/preview` | `skipped_analyzed` unico a casella spenta; `to_analyze` + `skipped_same_input` a casella accesa (P-8); blocco "nessuna da rifare" (G-12) |
| `GET` | `/api/connections` | Quarta voce `cloudflare`; `env_var` → `env_vars: string[]` (P-13) |
| `GET` | `/api/connections/:tool/runs` | `isToolId` accetta `cloudflare` |

## 14. Backlog (story product-facing, `relation_mode: body-links`, nessun tracker esterno)

Come per `people-first-crm`: nessun tracker esterno configurato, le story vivono qui e i task le referenziano
con un wikilink alla sezione della SPEC (`relation_mode: body-links`). Nessuna story nuova creata solo perché
un task esiste.

| Story | Titolo | Criteri SPEC | Task |
|---|---|---|---|
| OP-S1 | Una mia modifica non scade un'analisi | F7, F8, F11, F12, F13, H4, H7 | T3, T4, T6, T7 |
| OP-S2 | I miei post per intero | C6, C7, C8, C9, C15 | T5 |
| OP-S3 | I miei servizi, scritti a mano | B2, B3, B4, B10, G7, G9, G10 | T8, T10 |
| OP-S4 | Il profilo in un posto solo | B1, B5, B6, B7, B8, B9, G1, G2, G5 | T9, T11 |
| OP-S5 | L'analisi nomina il servizio più affine | F1–F6, F9, F10 | T13, T14, T15, T16 |
| OP-S6 | Cloudflare quarto strumento | A1–A9, H2 | T18, T19, T20, T21 |
| OP-S7 | Leggere le quattro superfici pubbliche | C1–C5, C10–C14 | T23 |
| OP-S8 | Generare con anteprima e spesa dichiarata | D1–D14, G3, G4, H6 | T24, T25, T26, T30 |
| OP-S9 | La proposta si applica voce per voce | E1–E13, G6, H1, H3, H5 | T27, T28, T31, T32 |
| OP-S10 | Coerenza, migrazione reale, documenti, testi in italiano | G8, Constraints, Data model | T0, T1, T2, T6, T7, T12, T17, T22, T29, T33 |

## 15. Task

### M1a — Invalidazione

### T0: Base git e baseline

- **depends_on**: []
- **location**: git; `brain/specs/prospect-crm/own-profile-services/`
- **description**: `git switch -c own-profile-services` da `people-first-crm@1c2ea85` (P-2): le modifiche non
  committate del brain passano sul branch nuovo. Se `pgrep -f "src/server/index.ts|job-entry"` trova processi
  del CRM, fermarli **per PID** (mai durante un job) e ricontrollare. Eseguire i 4 gate e annotarne l'esito
  come baseline, **con nessun'altra suite in corso**: il 2026-09-22 un `npm test` lanciato in parallelo a un
  altro ha dato 1 test rosso su 633, non riproducibile in cinque giri successivi — una baseline presa durante
  una corsa concorrente non è una baseline. Proporre all'utente il primo commit (SPEC, FLOW, PLAN, bookkeeping) e farlo **solo** col suo
  via.
- **validation**: `git branch --show-current` = `own-profile-services`;
  `git merge-base --is-ancestor 1c2ea85 HEAD`; `pgrep` senza processi del CRM; 4 gate verdi annotati.
- **status**: Done (2026-09-29)
- **log**: Branch e primo commit (`7049fe0`) già fatti dall'utente. `pgrep -f "src/server/index.ts|job-entry"`
  vuoto, nessuna suite o Vite in corso. Baseline in serie: typecheck ✅, `npm test` ✅ 633/633 (52 file), build
  web ✅, typecheck web ✅.
- **files edited/created**: nessun file di codice
- **backlog_item_id**: OP-S10
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#Constraints]]
- **relation_mode**: body-links
- **tdd_target**: n/a (preparazione): i 4 gate verdi sul branch nuovo prima di qualunque modifica.
- **review_mode**: cli

### T1: Schema, migrazione unica e kind pre-cablato

- **depends_on**: [T0]
- **location**: `src/db/schema.ts`, `src/jobs/types.ts`, `src/jobs/generate-profile.ts` (stub),
  `src/jobs/handlers.ts` (sole voci), `src/server/jobs.ts` (`JOB_KIND_LABELS`), `src/jobs/fake-deps.ts`
  (stub), `tests/schema.test.ts`, `tests/fixtures/schema-people-first-crm.sql`
- **description**: (1) **Prima** di cambiare lo schema, salvare in
  `tests/fixtures/schema-people-first-crm.sql` la DDL di un DB nuovo creato con lo `SCHEMA` attuale. (2) Tutto
  il delta di §6 in un colpo (P-3): le quattro tabelle nuove, le quattro colonne additive,
  `generate_profile` in `JOB_KINDS`, con `services.name_key` e il suo indice unico (P-23). (3) Il kind entra
  **pre-cablato a stub** nelle sei voci (`HANDLERS`, `REAL_DEPS`, `CONFIG_BLOCKERS`, `RETRY_PREVIEWS`,
  `RUN_TOOLS`, `JOB_KIND_LABELS`) + il fake, con `NotImplementedError` nell'handler:
  `tests/app-skeleton.test.ts:44-55` esige registry completi, e nessuna route lo raggiunge fino a M4.
  **Attenzione**: `tests/jobs.test.ts:606-627` pretende che per ogni kind le deps finte e quelle reali
  lancino con messaggi **diversi** (`expect(fake.message).not.toBe(real.message)`), quindi i due stub non
  possono condividere il testo — con un messaggio solo `npm test` diventa rosso. (4) `planSchemaMigration` +
  `migrateSchema`: ricostruzione di `jobs`, `ensureColumn` per le additive, backfill di `posts.text_complete`
  nella stessa transazione, con la condizione di P-24 (`length = 301` **e** ultimo carattere `…`), non
  `length = EXCERPT_MAX`. Il backfill di `subject_hash` è di T3 (serve il prompt, P-25). (5) Una riga di
  console della migrazione dichiara il reset una tantum del badge (P-20).
- **validation**: vitest: (a) DB da `schema-people-first-crm.sql` con dati su ogni tabella (persone, fonti,
  liste, attività, analisi, job di ogni kind, e **post prodotti da `upsertPost`**: uno da un testo di 500
  caratteri e uno da 120 — non righe scritte a mano, altrimenti la prova non vedrebbe la forma vera di
  `truncate`) → migrato con gli **stessi conteggi per ogni tabella**, `text_complete` = 0 sul primo e 1 sul
  secondo, `foreign_key_check` vuoto, **un** backup; (b) secondo `applySchema` = no-op senza backup; (c) DB
  nuovo = stesso schema del migrato; (d) un DB `schema-apollo-lookalike.sql` migra fino in fondo; (e) con un
  pid di job vivo la migrazione rifiuta senza modifiche; (f) vincoli: due servizi con `name_key` uguale
  rifiutati, **inclusa la coppia accentata** (`Qualità` / `QUALITÀ`, che un indice su `lower()` avrebbe
  accettato), un servizio col solo nome accettato, `origin` fuori enum rifiutato,
  `jobs.kind = 'generate_profile'` accettato; (g) `npm test` verde — registry completi **e** messaggi degli
  stub distinti tra fake e reali.
- **status**: Done (2026-09-29)
- **log**: RED 12 rossi → GREEN. Due correzioni al piano, in `IMPLEMENTATION-NOTES.md`: (1) il marcatore dei post
  è calcolato in JS (`isTruncatedExcerpt`: lunghezza UTF-16 > 300 **e** `…`), perché `length()` di SQLite conta
  i code point e un estratto con emoji risultava 264 → marcato integrale con la condizione `= 301`; (2)
  `JOBS_COLUMNS` copiava solo le colonne di crm-foundation: ricostruendo `jobs` sul DB reale avrebbe azzerato
  `tools`/`logged`/`detached` di ogni run. Fixture dei post = istantanea del vero `upsertPost` (T5 lo cambia).
  `serviceNameKey` in `util/fields.ts` (NFC + minuscole Unicode + senza spazi). Suite 639/639, typecheck ✅.
- **files edited/created**: `src/db/schema.ts`, `src/jobs/types.ts`, `src/jobs/generate-profile.ts` (nuovo, stub),
  `src/jobs/handlers.ts` (sole voci), `src/runs/outcome.ts` (`JOB_KIND_LABELS`), `src/jobs/fake-deps.ts` (stub +
  parole chiave vuote), `src/util/fields.ts` (`serviceNameKey`), `tests/schema.test.ts`,
  `tests/fixtures/schema-people-first-crm.sql` (nuovo), `tests/fixtures/posts-people-first-crm.json` (nuovo)
- **backlog_item_id**: OP-S10
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#Data model (delta, livello di dominio)]]
- **relation_mode**: body-links
- **tdd_target**: Un post salvato da `upsertPost` a partire da un testo di 500 caratteri risulta
  `text_complete = 0` dopo la migrazione, e uno da 120 caratteri `= 1`.
- **review_mode**: cli

### T2: Verifica della migrazione sulla copia del DB reale

- **depends_on**: [T1]
- **location**: `scripts/migration-check.ts`, `tests/migration-check.test.ts`
- **description**: Estendere lo script esistente (isolamento invariato: nessun import di `src/db/index.ts`, il
  sorgente **non si apre mai** con SQLite) ai conteggi nuovi: righe per tabella prima/dopo,
  `posts.text_complete` distribuito, `services` = 0, `analyses.subject_hash` ancora `NULL` (lo riempie T3),
  `foreign_key_check` vuoto, un solo backup. Lanciare `npm run db:migration-check` su una copia di
  `data/crm.db` e **riportare i numeri all'utente**, incluso quante analisi risultano oggi "da aggiornare": è
  la misura del reset di P-20. **Questa prova non copre il backfill dell'impronta**, che non esiste ancora: la
  seconda prova, su una copia fresca e dopo il backfill, è parte di T3 ed è un cancello di M1a (§16).
- **validation**: `npm run db:migration-check` sulla copia: nessuna differenza di conteggio, nessuna
  violazione FK, un backup; vitest: lo script rifiuta se un processo tiene aperto il sorgente, e non crea
  `-wal`/`-shm` accanto al sorgente.
- **status**: Done (2026-09-29)
- **log**: Report esteso con `posts` (marcatore C6), `backups`, `profileSettings` (solo sì/no, assunzione F6),
  `analyses.staleBefore` e `contentChanged` (impronta dei valori delle colonne preesistenti: prova che la
  ricostruzione di `jobs` copia e non riscrive; una mutazione di `JOBS_COLUMNS` la fa cadere). "Da aggiornare"
  lo conta un processo figlio (`scripts/migration-check-analyses.ts`, `DB_PATH` = la copia, rifiuta percorsi
  fuori da `os.tmpdir()`) con lo stesso predicato della scheda (`isAnalysisStale`, nuovo, usato dalla route):
  il processo principale continua a non importare `db/index.ts`. **Copia reale** (2026-09-29): OK; migrate
  `jobs`, `analyses`, `posts`; 16 tabelle con conteggi identici (68 persone, 78 fonti, 95 attività, 12
  analisi, 9 post, 4 job, 0 log), `contentChanged` vuoto, 0 violazioni FK, 1 backup, seconda migrazione
  no-op, sorgente intatto; post 4 integrali / 5 troncati / 0 non noti (la condizione SQL del piano dà lo stesso
  5: nessun post reale ha emoji); profilo: nome, descrizione, offerta compilati, i 4 campi nuovi vuoti (F6
  confermata); 0 servizi; **12 analisi, 0 "da aggiornare" oggi** (il reset di P-20 non spegne nessun badge).
- **files edited/created**: `scripts/migration-check.ts`, `scripts/migration-check-analyses.ts` (nuovo),
  `src/analysis/analyze.ts` (`isAnalysisStale`), `src/server/routes/analyze.ts` (usa il predicato),
  `tests/migration-check.test.ts`
- **backlog_item_id**: OP-S10
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#Constraints]]
- **relation_mode**: body-links
- **tdd_target**: `checkMigration` su una copia con dati riporta conteggi identici per ogni tabella e zero
  violazioni FK, senza creare file accanto al sorgente.
- **review_mode**: cli

### T3: L'impronta della persona, API e schermo — F7, F11, F12, F13

- **depends_on**: [T2]
- **location**: `src/analysis/prompt.ts`, `src/analysis/analyze.ts`, `src/db/analyses.ts`,
  `src/db/subject-hash.ts` (**nuovo**, il backfill), `src/server/index.ts` (la chiamata all'avvio),
  `scripts/migration-check.ts`, `src/server/routes/analyze.ts`, `web/src/components/AnalysisCard.tsx`,
  `web/src/api/types.ts`, `tests/analysis-prompt.test.ts`, `tests/analyze.test.ts`, `tests/api-fits.test.ts`
- **description**: **Un task solo, API e FE insieme** (§9): altrimenti F7 è vero nell'API e falso sullo
  schermo. (1) `buildAnalysisInput` restituisce anche `subjectHash`, dai **soli** blocchi `<profilo>` e
  `<segnali>`, estratti in una funzione così che l'hash non dipenda da uno `slice` (P-5); la frase finale che
  nomina l'ICP resta fuori (P-6). (2) `saveAnalysis` scrive `subject_hash`. (3)
  `GET /api/prospects/:id/analyses` calcola `stale` da `subject_hash`; `POST …/analyze` restituisce il valore
  vero (P-7). (4) **Backfill** (P-25): `backfillSubjectHashes(db)` in un modulo suo, `WHERE subject_hash IS
  NULL`, che riusa la **stessa** funzione di caricamento della persona del percorso a runtime (altrimenti
  l'impronta del backfill non combacerebbe con quella calcolata poi, e ogni analisi risulterebbe da
  aggiornare); chiamata da `src/server/index.ts` come già fa `fillMissingRunTools`, idempotente e silenziosa
  quando non c'è niente da riempire. **Non** in `schema.ts`: creerebbe un ciclo con `db/index.ts` e romperebbe
  l'isolamento dichiarato di `scripts/migration-check.ts`. (5) `migration-check` guadagna il conteggio
  `analyses` con `subject_hash IS NULL`, così la seconda prova sulla copia reale è misurabile. (6) FE, i tre
  consumatori: la riga diventa *"Questa persona è cambiata dopo l'analisi."* — **senza** attribuire il cambio a
  un gesto, perché nell'impronta entrano anche le interazioni della persona coi post dell'utente (F13); il
  badge resta; il bottone "Rianalizza" **resta secondario in ogni caso** (via la dipendenza da `stale` nel
  `variant`, FLOW F.4). L'hint del prezzo **non si tocca** (P-18).
  (6) Adeguare l'helper di `tests/api-fits.test.ts` che scrive un'analisi senza impronta. (7) Aggiornare i
  commenti che dichiarano l'invariante vecchia (`db/analyses.ts:9`, `db/prospects.ts:383`, `db/schema.ts:327`,
  `analysis/prompt.ts:12`).
- **validation**: vitest: (a) analizzata una persona, cambiare `company_description`, `company_offering` o un
  campo dell'ICP ⇒ `stale: false`; (b) **rinominare l'ICP** ⇒ `stale: false` (P-6); (c) cambiare
  `prospects.about` ⇒ `stale: true` (il caso esistente resta verde); (d) un arricchimento che riempie
  headline/azienda/ruolo ⇒ `stale: true`; (e) `POST …/analyze` su dati identici senza `force` ⇒
  `skipped_same_input` **e** `stale` coerente; (f) migrazione di un DB con analisi ⇒ tutte `stale: false`
  subito dopo, e `stale: true` dopo un `UPDATE prospects.about`; (g) nessuna riga con `subject_hash` `NULL`
  dopo il backfill; (h) l'impronta scritta dal backfill è **identica** a quella che `buildAnalysisInput`
  calcola subito dopo per la stessa persona (è la prova che il backfill non usa una query duplicata, P-25).
  **Prova sulla copia reale**, l'unica che riguarda righe vere: rifare una copia fresca di `data/crm.db`,
  migrarla, far girare il backfill e riportare all'utente `analyses` con `subject_hash IS NULL` = **0**,
  conteggi per tabella invariati, `foreign_key_check` vuoto, e quante analisi risultavano "da aggiornare"
  prima e dopo (il numero di P-20). `agent-browser`: (i) modificare la descrizione della propria azienda e
  tornare sulla scheda ⇒ nessun badge, nessuna riga; (j) arricchire la persona ⇒ badge + testo nuovo, bottone
  ancora secondario.
- **status**: Done (2026-09-29)
- **log**: RED (prompt, API, backfill) → GREEN. `subjectHashOf(prospect)` in `prompt.ts` dai soli blocchi
  `<profilo>`/`<segnali>` (estratti in `subjectBlocks`, usati anche dallo user prompt); guardia F6: l'impronta
  dell'input intero del contesto di test è quella calcolata col codice di `1c2ea85` (testo del prompt invariato
  al byte). `isAnalysisStale` ora confronta `subject_hash` (NULL = non scaduta); `POST …/analyze` calcola lo
  `stale` vero. Backfill in `src/db/subject-hash.ts` (`loadAnalysisSubject` + `subjectHashOf`, gli stessi del
  runtime; una lettura per persona perché l'impronta non dipende dall'ICP), chiamato da `src/server/index.ts`.
  `migration-check` fa girare il backfill nel figlio e riporta prima/dopo. **Seconda prova su copia fresca
  del DB reale** (2026-09-29): OK, 12 analisi, `backfilled` 12, `subject_hash IS NULL` = **0**, "da aggiornare"
  **0 prima e 0 dopo**, conteggi e valori preesistenti invariati, 0 FK, 1 backup. `agent-browser` (e2e :8841,
  Luca Bernardi): (i) descrizione dell'azienda cambiata da Impostazioni ⇒ nessun badge, nessuna riga; (j)
  arricchimento Apify ⇒ badge *da aggiornare* + *"Questa persona è cambiata dopo l'analisi."*, **Rianalizza**
  secondario (outline). Suite 648/648, typecheck ✅.
- **files edited/created**: `src/analysis/prompt.ts`, `src/analysis/analyze.ts`, `src/db/analyses.ts`,
  `src/db/prospects.ts` (tipo e SELECT di `subject_hash`), `src/db/subject-hash.ts` (nuovo),
  `src/db/schema.ts` (commento), `src/server/index.ts`, `src/server/routes/analyze.ts`, `src/jobs/fake-deps.ts`
  (seed con l'impronta), `scripts/migration-check.ts`, `scripts/migration-check-analyses.ts`,
  `web/src/components/AnalysisCard.tsx`, `web/src/api/types.ts`, `tests/analysis-prompt.test.ts`,
  `tests/analyze.test.ts`, `tests/api-fits.test.ts`, `tests/migration-check.test.ts`
- **backlog_item_id**: OP-S1
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#F. L'analisi delle persone usa il profilo]]
- **relation_mode**: body-links
- **tdd_target**: Dopo un'analisi, modificare la descrizione della propria azienda **non** rende l'analisi
  `stale`, mentre modificare l'About della persona sì.
- **review_mode**: mixed

### T4: In blocco chi è già analizzato si salta sempre — F8, G-12

- **depends_on**: [T3]
- **location**: `src/jobs/analyze.ts`, `src/server/routes/analyze.ts`,
  `web/src/components/IcpPickerDialog.tsx`, `tests/analyze.test.ts`
- **description**: **Un task solo, API e dialog insieme** (§9). (1) `planAnalysis`: il default di
  `onlyMissing` diventa **sempre** `true`, non più `params.listId !== undefined` (P-9). (2) Con `onlyMissing`
  acceso, **non** calcolare contesto e impronta dei già analizzati: tutti sotto `skipped_analyzed` (P-8). (3)
  Con `onlyMissing` spento: `skipped_same_input` per gli identici, il resto in `analyzeTargets`. (4)
  **Blocco** quando `to_analyze === 0` (G-12: nei `blockers`, non nei `warnings`, perché è l'unico modo per
  cui `JobPreviewDialog` disabilita **Avvia**), **in entrambi i casi**, con il motivo giusto: a casella accesa
  *"Nessuna delle N ha dati diversi da quando è stata analizzata: non ci sarebbe nulla da rifare."*, a casella
  spenta il motivo che vale davvero (tutte già analizzate, tutte senza LinkedIn, tutte senza dati). Il testo
  non deve affermare "dati identici" quando l'ambito è vuoto per un altro motivo. L'avviso esistente *"Nessuna
  persona da analizzare con queste opzioni."* (`src/jobs/analyze.ts:295`) va **sostituito** dal blocco, non
  affiancato: due frasi quasi identiche di cui una blocca e una no. (5) `force` **resta** nei `params` e
  nell'API per l'analisi singola (F11), ma il dialog in blocco non lo manda più. (6) Dialog: label **"Includi
  chi è già analizzato"**, descrizione *"L'anteprima dice quante rifarebbe e quante resterebbero saltate."* —
  **nessuna promessa** sugli input identici, perché dopo un ritocco al profilo nulla è più identico (§12);
  stato locale da `force` a `onlyMissing: false`, e il `summary` mostra i due gruppi (*"Da rifare: 12 · Input
  identico, saltate comunque: 116"*). (7) Parità con `retry-preview`.
- **validation**: vitest: (a) **selezione** di 3 persone con analisi e input cambiato, senza opzioni ⇒
  `to_analyze: 0`, `skipped_analyzed: 3` (oggi sarebbero 3 rianalisi a pagamento); (b) con
  `onlyMissing: false` ⇒ `to_analyze: 3`; (c) input identico e `onlyMissing: false` ⇒ `skipped_same_input: 3`,
  `to_analyze: 0`, **blocker** presente; (d) lista = stessa cosa della selezione; (e) `retry-preview` =
  preview di route (conteggi, stima, avvisi, blocchi); (f) con `onlyMissing` acceso il piano non legge il
  contesto dei già analizzati; (g) **precedenza**: lista filtrata (che passa `onlyMissing={true}` dall'esterno,
  `web/src/routes/lists.$id.tsx:460`) **più** casella spuntata ⇒ i parametri inviati hanno
  `onlyMissing: false`. È il clic che può spendere su un archivio intero, e la prop e la casella scrivono
  oggi la stessa chiave; (h) ambito vuoto per un motivo diverso (tutte senza LinkedIn) ⇒ blocco col motivo
  giusto, non con "dati identici". `agent-browser`: (i) selezionare 3 già analizzate ⇒ *"3 già analizzate
  (saltate)"*, `to_analyze: 0`; (j) spuntare la casella ⇒ i due gruppi e la stima si aggiornano; (k) caso zero
  da rifare ⇒ **Avvia** disabilitato col motivo.
- **status**: Done (2026-09-29)
- **log**: RED 9 → GREEN. `onlyMissing ?? true` nel piano, nella preview della selezione e in `POST /api/analyze`;
  a casella spenta i già analizzati vanno in `skipped_analyzed` **senza** leggere contesto e impronta (P-8);
  nuovo conteggio `to_redo` (già analizzati che finiscono tra i bersagli) per il gruppo *"Da rifare"*. Il
  blocco "niente da analizzare" (`emptyScopeBlocker`, solo nella preview e quindi anche in "Riprova…") sostituisce
  l'avviso *"Nessuna persona da analizzare con queste opzioni."* e dice il motivo vero: dati identici **solo**
  quando lo sono tutti, altrimenti già analizzate / senza LinkedIn / senza dati / misti. Il testo della riga (i)
  segue il FLOW (*"3 persone hanno già un'analisi per questo ICP: restano fuori."*), non la vecchia etichetta
  citata nella validazione. Dialog: casella **"Includi chi è già analizzato"** (vince sulla prop `onlyMissing`
  della lista), niente più `force`, due gruppi nel riepilogo; etichette di "Riprova…" allineate. Attese dei test
  esistenti adeguate al cambio voluto (una selezione non rianalizza più da sé). `agent-browser` (e2e :8841):
  (i) 3 selezionate già analizzate ⇒ 0 da analizzare + riga del FLOW + **Avvia** disabilitato col motivo; (j)
  casella ⇒ *"Da rifare: 1 · Input identico, saltate comunque: 2."* e stima $0,03; (k) 2 identiche + casella ⇒
  *"Nessuna delle 2 ha dati diversi…"*, **Avvia** disabilitato; (g) lista (prop `onlyMissing`) + casella ⇒
  *"Da rifare: 2"*. Suite 653/653, typecheck, build e typecheck web ✅.
- **files edited/created**: `src/jobs/analyze.ts`, `src/server/routes/analyze.ts`,
  `web/src/components/IcpPickerDialog.tsx`, `web/src/components/RetryPreviewDialog.tsx`, `web/src/api/types.ts`,
  `tests/analyze.test.ts`
- **backlog_item_id**: OP-S1
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#F. L'analisi delle persone usa il profilo]]
- **relation_mode**: body-links
- **tdd_target**: Una **selezione** di persone già analizzate con input cambiato produce `to_analyze: 0`.
- **review_mode**: mixed

### T5: Post con testo integrale e tagli alla lettura — C6, C7, C8, C9, C15

- **depends_on**: [T4]
- **location**: `src/db/posts.ts`, `src/jobs/sync-interactions.ts`, `src/db/prospects.ts`,
  `src/db/person-merge.ts`, `web/src/components/settings/PostsCard.tsx`,
  `web/src/components/ProspectTable.tsx`, `web/src/routes/people.$id.tsx`, `tests/posts.test.ts`
- **description**: **Atomico** (§9): C7 e C15 nello stesso task, il più presto possibile, perché C9 vieta il
  recupero retroattivo e il testo integrale si accumula solo dal rilascio. (1) `upsertPost` **conserva il
  testo integrale** (`text_complete = 1`); il troncamento a `EXCERPT_MAX` smette di essere una scrittura e
  diventa una lettura. (2) I post già salvati restano come sono (C9). (3) **C15**: le rese da controllare sono
  **cinque**, non tre, e due sono già coperte — censite per non romperle:
  corpo della card di "I miei post" e il suo `title` (**da tagliare**: oggi il `title` è il testo conservato
  per intero); l'etichetta della fonte nell'elenco delle persone (**da tagliare**); l'anteprima di unione, già
  al sicuro perché l'estratto lo costruisce il server tagliando a 30 (`src/db/person-merge.ts`); e il `title`
  del riferimento al post sulla scheda persona (`web/src/routes/people.$id.tsx`), che rende il valore grezzo
  ed è al sicuro **solo** perché `src/db/prospects.ts:589` lo tronca a 120 — quel troncamento **non va
  toccato**, è la guardia. (4) Esporre `text_complete` dove serve a C8.
- **validation**: vitest: (a) post di 500 caratteri sincronizzato ⇒ salvato intero, `text_complete = 1`; (b)
  post preesistente di esattamente 300 ⇒ `text_complete = 0` dopo la migrazione, e un nuovo sync lo porta a
  `1` col testo intero; (c) ogni lettura che oggi restituisce un estratto continua a restituirne uno **non
  più lungo di prima**, anche per i post integrali: una asserzione per ciascuna delle **cinque** rese, incluse
  le due già coperte (il taglio a 30 dell'anteprima di unione e il troncamento a 120 di
  `src/db/prospects.ts:589`), così una regressione futura le fa cadere invece di passare in silenzio; (d)
  l'input dell'analisi, `inputHash` e `subjectHash` sono identici prima e dopo, a parità di post.
  `agent-browser`: (e) il `title` di un post integrale in "I miei post" è tagliato, e quello del riferimento
  al post sulla scheda persona resta corto.
- **status**: Done (2026-09-29)
- **log**: RED 4 → GREEN. `upsertPost` conserva il testo integrale (`text_complete = 1`; un testo nuovo porta a 1
  anche un post salvato troncato, un sync senza testo non tocca testo né marcatore). Il taglio per le viste è
  una lettura: `excerptOf` (stessa lunghezza di prima, `EXCERPT_MAX` + `…`) in `GET /api/posts` **e** in
  `loadSources` (fonti di scheda e righe). **Correzione al piano**: la scheda (`GET /api/prospects/:id`) **non**
  era protetta dal taglio a 120 di `prospects.ts` (quello vale solo per le righe delle tabelle): restituiva il
  testo conservato così com'è, quindi da T5 avrebbe messo l'intero post nel `title` del riferimento al post.
  L'ha trovato il test della scheda; ora passa da `excerptOf`, le righe restano tagliate a 120 sopra. Anteprima
  di unione (30) invariata; l'analisi legge il testo integrale ma il prompt lo tronca a 160: impronte identiche
  (test). `text_complete` esposto in `Post` (API e tipo FE) per C8. Test in `tests/posts.test.ts` (nuovo) su
  tutte le rese. `agent-browser` (e2e :8841, post 1 del seed conservato a 363 caratteri): "I miei post" corpo su
  2 righe e `title` 301, riferimento al post sulla scheda di Giulia `title` 301 e testo a 90 caratteri. Suite
  659/659, typecheck, build e typecheck web ✅.
- **files edited/created**: `src/db/posts.ts`, `src/db/prospects.ts` (`loadSources`), `web/src/api/types.ts`,
  `tests/posts.test.ts` (nuovo). Nessuna modifica necessaria a `PostsCard.tsx`, `ProspectTable.tsx`,
  `people.$id.tsx`, `person-merge.ts` e `sync-interactions.ts`: il taglio sta nell'API che li alimenta.
- **backlog_item_id**: OP-S2
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#C. Le fonti pubbliche]]
- **relation_mode**: body-links
- **tdd_target**: Un post di 500 caratteri si salva intero con `text_complete = 1`, e l'etichetta della fonte
  nell'elenco delle persone resta breve.
- **review_mode**: mixed

### T6: Seed e2e e documenti che ora sono falsi — H7

- **depends_on**: [T5]
- **location**: `src/jobs/fake-deps.ts`, `scripts/e2e-server.ts`, `tests/e2e/README.md`, `README.md`,
  `.env.example`, `brain/domains/prospect-crm/prospect-crm-contract.md`,
  `brain/specs/prospect-crm/crm-foundation/PLAN.md`, `brain/specs/prospect-crm/people-first-crm/PLAN.md`
- **description**: (1) Seed: post misti (integrali e troncati), persone con analisi **e** impronta coerente,
  **una** persona la cui analisi è già "da aggiornare" per un cambio suo (per lo smoke di F13), una selezione
  di già analizzate per lo smoke di F8. È l'armatura che ogni smoke successivo legge. (2) Documenti che ora
  sono falsi (P-19, H7): `README.md:76` (tre motivi di invalidazione → uno, quello della persona) **e la
  dichiarazione del reset una tantum** (P-20); `tests/e2e/README.md:98` (il seed non si descrive più per
  l'hash dell'input intero); il contract (`stale` = impronta della **persona**); i punti dei PLAN di
  `crm-foundation` e `people-first-crm` che descrivono il badge; `.env.example` con le chiavi nuove di §6.
  **Non toccare**, perché restano veri: `README.md:157` (scritture Apollo),
  `apollo-lookalike/SPEC.md:427-429`, `people-first-crm/SPEC.md:289`.
- **validation**: `POST /api/e2e/reset|seed` ⇒ la persona marcata mostra `stale: true` e tutte le altre no;
  `grep -rn "input_hash\|da aggiornare\|stale"` sui documenti citati ⇒ nessuna frase che descriva
  l'invalidazione da modifica dell'utente, e le tre righe dichiarate "restano vere" ancora lì invariate;
  `npm test` verde.
- **status**: Done (2026-09-29)
- **log**: Seed (`seedOwnProfile`, `own_profile` nella risposta): post 1 (più lungo di 300) riportato alla forma di prima
  del rilascio (`truncate(testo, 300)`, `text_complete = 0`), post 2 integrale; **Elena Sartori** aggiunta a mano con
  LinkedIn (così Da smistare, liste e conteggi asseriti dagli altri scenari non cambiano), analisi medio e poi About
  corretto a mano ⇒ **unica** analisi `stale: true`; Luca Bernardi, Marco Ferri ed Elena = le tre già analizzate per
  F8. Helper `saveSeedAnalysis` condiviso con lo scenario di people-first-crm. Test nuovo in `e2e-deps` (tutte le
  coppie analizzate: solo Elena `stale`; mutazione verificata: senza la correzione dell'About il test cade). Documenti:
  `README.md` (motivi di "da aggiornare" = solo la persona; F8 in blocco; paragrafo "Aggiornamento a profilo e
  servizi" con il **reset una tantum** dichiarato, P-20; 20 tabelle), `tests/e2e/README.md` (Luca "impronta della
  persona coerente", scenario own-profile-services, chiavi del seed), contract (`stale` = `subject_hash`), PLAN di
  crm-foundation (definizione di `stale` marcata superata), `.env.example` (chiavi di §6 **commentate e dichiarate non
  ancora lette**, con la tappa che le introduce, per non documentare comportamenti che non esistono — P-19).
  **Deviazione da H7**: `README.md` sulle scritture Apollo era vero solo a metà — le scritture sul prospect scadono
  ancora l'analisi, l'arricchimento Apollo delle aziende di riferimento (dati dell'ICP, nel system prompt) no più:
  corretta solo quella metà. Il PLAN di people-first-crm non ha frasi diventate false (il badge "solo sull'AI" e "hash
  reale, non da aggiornare" restano veri): non toccato. `apollo-lookalike/SPEC.md` e `people-first-crm/SPEC.md`
  non toccati. Il contract è stato corretto su una riga (frontmatter `ingested` invariato): la sintesi resta a
  `docs-maintenance`. Suite 660/660.
- **files edited/created**: `src/jobs/fake-deps.ts`, `tests/e2e-deps.test.ts`, `tests/e2e/README.md`, `README.md`,
  `.env.example`, `brain/domains/prospect-crm/prospect-crm-contract.md`, `brain/specs/prospect-crm/crm-foundation/PLAN.md`
- **backlog_item_id**: OP-S1
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#H. Coerenza con il dominio]]
- **relation_mode**: body-links
- **tdd_target**: Dopo `seed`, una persona del dataset ha `stale: true` per un cambio suo e tutte le altre
  `stale: false`.
- **review_mode**: cli

### T7: Smoke M1a e chiusura di tappa

- **depends_on**: [T6]
- **location**: `tests/e2e/smoke-profile.md` (nuovo)
- **description**: Smoke `agent-browser`: i due casi opposti di F7/F13, i due conteggi e il blocco di F8, il
  reset del badge (sparisce, si arricchisce una di quelle persone, **ricompare col testo nuovo** — la metà di
  F.6 che appartiene a questa tappa, §9), C15 sulle tre superfici. Chiudere: 4 gate, numeri di T2, riepilogo
  all'utente **con la dichiarazione del reset** e dove trovare il backup (P-20).
- **validation**: smoke senza BLOCKER; 4 gate verdi; nessun segreto nei log.
- **status**: Done (2026-09-29)
- **log**: Smoke in `tests/e2e/smoke-profile.md`: **17 righe OK**, nessun BLOCKER né bug (F7 su azienda e ICP
  rinominato, F13 su Elena, F8 spenta/accesa/zero da rifare/precedenza, C6/C7/C9, C15 su I miei post, filtro
  "Post", righe, scheda e anteprima di unione, G8). **Reset del badge** provato con l'entry reale del server su una
  copia scratch "pre-rilascio": riga di console del backfill, badge spariti su Elena e Luca, ricomparso su Luca
  dopo l'arricchimento con il testo nuovo e **Rianalizza** secondario. Nessun segreto nei log e nei dettagli di 20
  run. `simplify` (4 revisori: riuso, semplificazione, efficienza, altitudine) applicato prima dei gate: blocchi
  della persona calcolati una volta; `isAnalysisStale(latest, persona)`; **l'avvio dell'analisi in blocco usa i
  blocchi della preview** (un `POST` con zero da analizzare risponde 400 `blocked` invece di lanciare un job vuoto,
  come gli altri kind); `to_redo` derivato; backfill per persona; controllo "copia scratch" condiviso in
  `scripts/scratch-paths.ts`; F8 ricontrollato a schermo dopo il refactoring. Gate finali: typecheck ✅, `npm test`
  **660/660** (53 file) ✅, build web ✅, typecheck web ✅. `migration-check` sulla copia reale rieseguito dopo
  `simplify`: OK, stessi numeri.
- **files edited/created**: `tests/e2e/smoke-profile.md` (nuovo); da `simplify`: `src/analysis/prompt.ts`,
  `src/analysis/analyze.ts`, `src/server/routes/analyze.ts`, `src/jobs/analyze.ts`, `src/db/subject-hash.ts`,
  `src/db/schema.ts`, `src/jobs/fake-deps.ts`, `scripts/migration-check.ts`, `scripts/migration-check-analyses.ts`,
  `scripts/scratch-paths.ts` (nuovo), `web/src/components/IcpPickerDialog.tsx`, `tests/analyze.test.ts`;
  `brain/tech-debt/prospect-crm/own-profile-services.md` (nuovo, OP-TD-1)
- **backlog_item_id**: OP-S10
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#F. L'analisi nomina il servizio più affine]]
- **relation_mode**: body-links
- **tdd_target**: n/a (tappa): lo smoke è la verifica.
- **review_mode**: browser

### M1b — Servizi e campi del profilo

### T8: Servizi: repo e API — B2, B3, B4, B10

- **depends_on**: [T7]
- **location**: `src/db/services.ts` (nuovo), `src/server/routes/services.ts` (nuovo), `src/server/app.ts`
  (sola riga di mount), `tests/api-services.test.ts` (nuovo)
- **description**: Repo con `listServices` (in `position`), `createService`, `updateService`,
  `deleteService`, `reorderServices` e **un solo** normalizzatore del nome, che scrive `services.name_key` a
  ogni scrittura (P-23): l'indice unico vede esattamente ciò che ha scritto il normalizzatore, quindi API e
  database non possono divergere. Il normalizzatore piega maiuscole **con gli accenti**
  (`toLocaleLowerCase('it')`) e toglie tutti gli spazi.
  Route: `GET·POST /api/services`, `PATCH·DELETE /api/services/:id`, `PUT /api/services/order`. Nome
  obbligatorio; collisione ⇒ 409 `{code:'service_exists'}` col nome esistente nel messaggio.
  `origin='manual'` e `origin_at` a ogni scrittura a mano (B6). Creazione in fondo; `reorderServices` riceve
  l'ordine completo degli id e lo rende contiguo. **Niente oltre B2**: solo il nome obbligatorio, nessuna
  validazione in più (§9, la persona).
- **validation**: vitest: (a) creato col solo nome ⇒ 201 e gli altri campi `null`; (b) *"Assessment
  Architetturale"* dopo *"assessment  architetturale"* ⇒ 409 `service_exists`, nulla salvato, **e** *"QUALITÀ"*
  dopo *"Qualità"* ⇒ 409 (il caso che un indice su `lower()` avrebbe accettato, §7); (c) tre servizi
  riordinati ⇒ `GET` nell'ordine dichiarato, posizioni contigue; (d) `PATCH` che non nomina un campo lo lascia
  invariato; (e) `DELETE` di un id inesistente ⇒ 404; (f) `origin`/`origin_at` valorizzati e aggiornati a ogni
  `PATCH`.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S3
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#B. Profilo e servizi]]
- **relation_mode**: body-links
- **tdd_target**: `POST /api/services {name: 'Fractional CTO'}` crea il servizio; un secondo con
  `'fractional  cto'` risponde 409 senza scrivere.
- **review_mode**: cli

### T9: Profilo esteso e lettura unica (API) — B1, B5, B6, B7, B8, C11, G-11

- **depends_on**: [T8]
- **location**: `src/db/settings.ts`, `src/db/profile.ts` (nuovo), `src/server/routes/settings.ts`,
  `src/server/routes/profile.ts` (nuovo), `src/server/app.ts` (sola riga di mount: `createApp` monta i router
  uno per uno, senza questa il `GET /api/profile` risponderebbe 404), `src/util/fields.ts`,
  `tests/api-profile.test.ts` (nuovo)
- **description**: (1) `SETTING_KEYS` += `website_url`, `positioning`, `proof_points`, `tone_of_voice`; lo zod
  di `PUT /api/settings` li accetta. (2) `website_url` normalizzato e ridotto a dominio con
  `normalizeDomain`; un indirizzo da cui non si ricava un dominio **non blocca** il salvataggio ma lo dichiara
  nella risposta (C11). (3) Scrivere a mano un campo generabile marca `profile_field_origin.origin='manual'`
  (P-10) — **da qui**, cioè prima che esista un apply, perché è ciò che E8/E9 dovranno proteggere. I tre campi
  già nel database **non** ricevono nessuna riga (G-11): nessuna provenienza mostrata, sostituibili senza
  conflitto. (4) `GET /api/profile` (B7) **già con le chiavi di M4** a `null` (P-21): input, campi generabili,
  provenienza per campo, servizi in ordine, esito per fonte, data e modello dell'ultima generazione,
  `has_pending_proposal`, il **record d'impresa Apollo** così come è arrivato (è il dato che B9 vuole mostrato
  in sola lettura col profilo, non come azienda del CRM), più il conteggio dei campi generabili **già compilati
  senza provenienza**, che è ciò che la testata di E14 dichiarerà. (5) `getReadiness` invariato (B8).
- **validation**: vitest: (a) `GET /api/profile` a DB vuoto ⇒ tutti i campi `null`, `services: []`, chiavi di
  M4 presenti a `null`, **200** (B5); (b) `PUT` dei campi nuovi ⇒ letti con `origin: 'manual'` e data; (c)
  `GET /api/settings` e `getReadiness` **identici** a prima per le quattro chiavi vecchie (B8); (d) con i tre
  campi legacy valorizzati e mai riscritti ⇒ nessuna provenienza e il conteggio di G-11 = 3; riscritto uno a
  mano ⇒ provenienza su quello e conteggio = 2; (e) `website_url` senza dominio ricavabile ⇒ salvato +
  avviso; (f) il contesto dell'analisi legge i campi nuovi quando ci sono e **non cambia** quando sono vuoti.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S4
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#B. Profilo e servizi]]
- **relation_mode**: body-links
- **tdd_target**: `GET /api/profile` restituisce in **una** risposta profilo, servizi in ordine e provenienza
  di ogni valore, e i tre campi legacy risultano senza provenienza.
- **review_mode**: cli

### T10: FE — card "I miei servizi" — B4, G7, G9, G10

- **depends_on**: [T9]
- **location**: `web/src/components/settings/ServicesCard.tsx` (nuovo),
  `web/src/routes/settings.profile.tsx`, `web/src/api/{client,types}.ts`
- **description**: Nell'ordine che l'UX impone (§8): **stato vuoto** (*"Nessun servizio. Aggiungine uno a
  mano."* — copy provvisoria, §10) → **Aggiungi** coi suoi due errori (nome duplicato B10, nome vuoto B2) →
  **riordino** → **Elimina con la sua conferma** (G7), mai separate. Tabella con `caption` *"I miei servizi, in
  ordine"*, colonne Ordine (↑ ↓) · Nome · A chi serve · Problema · Provenienza · azioni; **Dettagli** per
  descrizione, prove e note. Riordino immediato con annuncio `polite` della posizione e focus che resta sul
  bottone premuto. Conferma di eliminazione in versione breve (§10: la frase su F5 arriva in T16).
- **validation**: `agent-browser`: (a) card vuota ⇒ un bottone solo, nessuna CTA di generazione (§10); (b)
  aggiunto col solo nome ⇒ riga in fondo, focus sulla riga, toast; (c) nome duplicato a meno di maiuscole ⇒
  errore inline, niente salvato; (d) nome vuoto ⇒ errore e focus sul campo; (e) ↑ ↓ ⇒ ordine persistito dopo
  ricarica, live region annuncia *"«X» è ora 2 di 5"*; (f) eliminazione ⇒ conferma con focus su **Annulla**,
  testo senza "da rifare"; (g) **error path del FLOW**: riordino fallito ⇒ *"Ordine non salvato: …"* e ordine
  ripristinato; (h) tutto da tastiera; (i) build + typecheck.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S3
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#D. I servizi a mano, in qualsiasi momento]]
- **relation_mode**: body-links
- **tdd_target**: Aggiungere un servizio col solo nome lo fa comparire in fondo alla tabella, e un omonimo a
  meno di maiuscole mostra l'errore inline senza salvare.
- **review_mode**: browser

### T11: FE — "I tuoi indirizzi pubblici", "La mia azienda" estesa, una colonna — G1, G2, G5, B6, OQ-8

- **depends_on**: [T10]
- **location**: `web/src/components/settings/ProfileForms.tsx`, `web/src/routes/settings.profile.tsx`
- **description**: (1) La card `#profilo` si chiama **"I tuoi indirizzi pubblici"** e contiene profilo
  LinkedIn **+ Sito web**; `id` del campo e ancora `#profilo` invariati (G2). L'hint del sito resta neutro
  finché M4 non lo legge (§10). (2) La card `#azienda` guadagna Posizionamento · Prove e risultati · Tono di
  voce, e **sotto ogni campo** la provenienza quando c'è (B6); i tre campi legacy non ne mostrano (G-11). (3)
  La pagina passa a **una colonna** (i campi nuovi sono testi lunghi), nell'ordine del FLOW; le card della
  generazione e della proposta arrivano in M4. (4) Errore sotto il campo quando dal sito non si ricava un
  dominio, senza bloccare il salvataggio.
- **validation**: `agent-browser`: (a) **regressione delle ancore**: `/settings/profile#profilo` mette a fuoco
  il campo del profilo e `#azienda` la descrizione, come prima (G2, OQ-8); (b) salvare il sito ⇒ persistito,
  provenienza con la data; (c) sito senza dominio ⇒ messaggio sotto il campo, salvataggio riuscito; (d) i tre
  campi nuovi salvano e ricompaiono dopo ricarica, con la provenienza; (e) i tre campi legacy non mostrano
  provenienza finché non li riscrivi; (f) build + typecheck.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S4
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#Architettura della pagina `/settings/profile`]]
- **relation_mode**: body-links
- **tdd_target**: `/settings/profile#profilo` mette a fuoco il campo del profilo LinkedIn nella card
  rinominata, e il sito salvato ricompare dopo un ricarico con la sua provenienza.
- **review_mode**: browser

### T12: Smoke M1b e chiusura di tappa

- **depends_on**: [T11]
- **location**: `tests/e2e/smoke-profile.md`
- **description**: Smoke del percorso D del FLOW per intero (con la copy provvisoria di §10) più la
  regressione delle ancore. Chiusura di tappa come T7.
- **validation**: smoke senza BLOCKER; 4 gate verdi.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S10
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#D. I servizi a mano, in qualsiasi momento]]
- **relation_mode**: body-links
- **tdd_target**: n/a (tappa).
- **review_mode**: browser

### M2 — L'analisi nomina il servizio affine

### T13: Contesto e forma dell'analisi — F1, F2, F6

- **depends_on**: [T12]
- **location**: `src/analysis/prompt.ts`, `src/analysis/schema.ts`, `src/db/icps.ts`,
  `tests/analysis-prompt.test.ts`
- **description**: (1) `AnalysisContext` guadagna posizionamento, prove, tono di voce e l'elenco dei servizi
  (nome, a chi serve, problema); `systemPrompt` li aggiunge nei blocchi esistenti, **omettendo** i campi vuoti
  come già fa. (2) Con **almeno un servizio**, "Cosa produrre" chiede `best_service` +
  `best_service_reason` e `AnalysisSchema` li include; **senza servizi** né i dati né la forma della risposta
  cambiano di un carattere (F2, F6). (3) `toStructuredOutputSchema` continua a filtrare le keyword non
  supportate. (4) **Regressione di F7 per un servizio**: la prova che M1a non poteva fare, perché i servizi
  entrano nel prompt solo adesso.
- **validation**: vitest: (a) a campi nuovi vuoti e zero servizi, `system`, `user`, `inputHash` e
  `subjectHash` sono **identici** a prima del task (F6); (b) con tre servizi, il system prompt li elenca
  nell'ordine dell'utente e lo schema ha i due campi nuovi; (c) con posizionamento valorizzato e zero servizi,
  il prompt lo contiene e lo schema **no**; (d) **analizzata una persona, poi modificato o eliminato un
  servizio ⇒ `stale: false`** (F7, la regressione che appartiene a questa tappa); (e) il JSON Schema resta
  accettabile per structured outputs.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S5
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#F. L'analisi delle persone usa il profilo]]
- **relation_mode**: body-links
- **tdd_target**: Senza servizi, l'input dell'analisi è identico a quello di prima; con tre servizi, lo schema
  della risposta chiede il servizio più affine — e modificare un servizio non rende `stale` nessuna analisi.
- **review_mode**: cli

### T14: Servizio affine: casi degradati, poi il caso felice — F3, F4, F5, F9

- **depends_on**: [T13]
- **location**: `src/analysis/analyze.ts`, `src/db/analyses.ts`, `src/db/prospects.ts`,
  `tests/analyze.test.ts`
- **description**: Ordine imposto dall'UX (§8): sul DB reale **ogni** analisi è anteriore al rilascio, quindi i
  casi degradati sono la normalità. (1) Analisi con le colonne vuote ⇒ nessun servizio affine, nessun campo
  etichettato vuoto (F9, F3). (2) Risposta non riconducibile a un servizio esistente ⇒ colonne `NULL`, analisi
  **valida** (F3). (3) `saveAnalysis` scrive `best_service_name` come **testo di allora** (F4) e
  `best_service_reason`. (4) Le letture espongono i due campi e dicono se quel nome è ancora tra i servizi
  (F5), senza errori.
- **validation**: vitest: (a) analisi con colonne `NULL` ⇒ la risposta non porta nessun servizio affine; (b)
  risposta che nomina un servizio inesistente ⇒ colonne `NULL`, analisi valida; (c) analisi che nomina il
  secondo servizio ⇒ nome e motivo salvati, la card dice che esiste; (d) rinominato quel servizio ⇒ nome **di
  allora** e "non esiste più", senza errore; (e) eliminato ⇒ stesso comportamento; (f) un servizio rinominato
  e poi ricreato col vecchio nome ⇒ torna "esistente" (l'analisi cita testo, non un id).
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S5
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#F. L'analisi delle persone usa il profilo]]
- **relation_mode**: body-links
- **tdd_target**: Un'analisi che nomina un servizio poi rinominato mostra il nome di allora e dichiara che
  quel servizio non esiste più, senza errori.
- **review_mode**: cli

### T15: La stima dell'analisi da una funzione sola — F10, D5

- **depends_on**: [T14]
- **location**: `src/jobs/analyze.ts`, `src/config.ts`, `web/src/components/AnalysisCard.tsx`,
  `web/src/api/types.ts`, `tests/analyze.test.ts`
- **description**: (P-18, P-27) Il difetto non è il valore, è la **duplicazione**: il prezzo è scritto a mano
  **tre volte** nell'hint della card (`AnalysisCard.tsx:228`, `:230`, `:231`) oltre a stare nella preview, e
  `config.prices.analysisPerProspectUsd` è una **costante nel codice**, non una variabile d'ambiente. Quindi:
  (1) nuova `PRICE_ANALYSIS_USD` col default dell'attuale `0.03`, così chi non tocca il `.env` non vede
  cambiare niente; (2) una funzione sola calcola la stima e la servono la preview in blocco **e** l'hint della
  card, in **tutti e tre** i suoi rami (arricchimento prima, rianalisi, prima analisi), che passano al testo
  finale del FLOW (§10); (3) `null` ⇒ **"stima non disponibile"**, mai un numero inventato (D5). **Non** è un
  modello a token: la stima resta un prezzo per persona (P-27), e F10 chiede che sia dichiarata, non che sia
  proporzionale all'input.
- **validation**: vitest: (a) preview in blocco e valore servito alla card leggono **la stessa** funzione (un
  cambio di `PRICE_ANALYSIS_USD` muove entrambi); (b) `PRICE_ANALYSIS_USD` vuoto ⇒ `null` in entrambe; (c)
  assente dal `.env` ⇒ 0,03, cioè il comportamento di oggi. `agent-browser`: (d) i **tre** rami dell'hint
  mostrano il numero servito dal server, e nessuno ne contiene uno scritto a mano (grep su
  `AnalysisCard.tsx`: zero occorrenze di `0,03`); (e) col prezzo vuoto, tutti e tre dicono *"stima non
  disponibile"*; (f) build + typecheck.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S5
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#F. L'analisi delle persone usa il profilo]]
- **relation_mode**: body-links
- **tdd_target**: Cambiando `PRICE_ANALYSIS_USD`, la preview in blocco e tutti e tre i rami dell'hint della
  card cambiano insieme; svuotandola, dicono tutti "stima non disponibile".
- **review_mode**: mixed

### T16: FE — riga "Servizio più affine" e testi finali di M1b

- **depends_on**: [T15]
- **location**: `web/src/components/AnalysisCard.tsx`, `web/src/api/types.ts` (i due campi nuovi),
  `web/src/components/settings/ServicesCard.tsx`, `web/src/components/settings/ProfileForms.tsx`
- **description**: (1) Riga **Servizio più affine** sotto il riassunto quando l'analisi l'ha prodotta, come
  parte del testo dell'analisi (nessun badge solo grafico); **nessuna riga** quando non c'è (F3, F9). Caso
  "non è più tra i tuoi servizi" come frase, senza link e **senza invito a rianalizzare** (F7). (2) I tre
  testi provvisori di M1b che ora possono dire la verità (§10): l'hint dell'ordine dei servizi, l'hint dei
  campi nuovi dell'azienda, e la frase su F5 nella conferma di eliminazione.
- **validation**: `agent-browser`: (a) persona con servizio affine ⇒ riga con nome e motivo; (b) persona
  analizzata prima del rilascio ⇒ **nessuna** riga; (c) servizio eliminato ⇒ frase col nome di allora, nessun
  invito; (d) i tre testi di §10 sono quelli del FLOW; (e) **edge del FLOW**: un servizio proposto col nome
  scritto con maiuscole o spazi diversi mostra *"Corrisponde al tuo servizio «…» (il confronto ignora maiuscole
  e spazi). Il nome resta il tuo."*; (f) screen reader: la riga è testo dentro l'analisi; (g) build +
  typecheck.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S5
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#F. L'analisi nomina il servizio più affine]]
- **relation_mode**: body-links
- **tdd_target**: La scheda di una persona con servizio affine mostra la riga; quella di un'analisi anteriore
  al rilascio non mostra nessuna riga vuota.
- **review_mode**: browser

### T17: Smoke M2 e chiusura di tappa

- **depends_on**: [T16]
- **location**: `tests/e2e/smoke-profile.md`
- **description**: Smoke del percorso F con servizi scritti a mano, incluso il servizio eliminato e la metà di
  F.6 che appartiene a questa tappa (§9: *"tre schede analizzate prima del rilascio non mostrano la riga del
  servizio"*). Chiusura di tappa.
- **validation**: smoke senza BLOCKER; 4 gate verdi.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S10
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#F. L'analisi nomina il servizio più affine]]
- **relation_mode**: body-links
- **tdd_target**: n/a (tappa).
- **review_mode**: browser

### M3 — Cloudflare quarto strumento

### T18: Catalogo a quattro, due variabili, redazione, e l'assenza — A1, A3, A4, A7, A9

- **depends_on**: [T17]
- **location**: `src/runs/tools.ts`, `src/config.ts`, `src/db/runs.ts`, `src/server/routes/runs.ts`,
  `web/src/api/types.ts`, `.env.example`, `tests/runs-tools.test.ts`
- **description**: (1) `TOOL_IDS` += `cloudflare`; `Tool.env_var` → `env_vars: string[]` (P-13) e il segreto
  da redigere dichiarato a parte: l'identificativo dell'account **non** è un segreto. (2) `configured()` di
  Cloudflare = **entrambe** le variabili presenti (A4). (3) `redactSecrets` continua a iterare il catalogo,
  quindi il token è coperto **prima** che esista un client (A7, §8). (4) `isToolId('cloudflare')` ⇒ la route
  dello strumento non risponde più 404. (5) **A9 come stato vuoto della tappa**: senza credenziali nessuna
  chiamata parte e nient'altro del CRM si degrada — provato prima che esista un caso felice.
- **validation**: vitest: (a) con nessuna e con **una sola** delle due variabili ⇒ non configurata, e il
  payload dice quale manca; (b) con entrambe ⇒ configurata; (c) `redactSecrets` sostituisce il token e **non**
  l'account id; (d) `GET /api/connections` ha quattro voci; `GET /api/connections/cloudflare/runs` ⇒ 200; (e)
  senza credenziali, ogni altro kind e ogni altra preview si comportano come prima.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S6
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#A. Cloudflare come quarto strumento]]
- **relation_mode**: body-links
- **tdd_target**: Con solo `CLOUDFLARE_ACCOUNT_ID` impostato, lo strumento risulta **non** configurato e il
  payload nomina la variabile mancante; il token non appare in nessun messaggio redatto.
- **review_mode**: cli

### T19: FE — quarta card in Connessioni — A3, A4

- **depends_on**: [T18]
- **location**: `web/src/components/runs/ConnectionCard.tsx`,
  `web/src/routes/settings.connections.index.tsx`, `web/src/api/types.ts`
- **description**: La card mostra **tutte** le variabili dello strumento e nomina quella che manca (P-13);
  Cloudflare con *"Abilita: lettura del tuo sito per la generazione del profilo."* Rivedere la griglia: quattro
  card in `lg:grid-cols-3` lasciano la quarta sola su una riga. La card legge la salute dall'insieme che T21
  estende (P-26), non solo dai run falliti: altrimenti un run riuscito con il sito non letto non la farebbe
  mai diventare rossa e A5/A6 resterebbero inverificabili.
- **validation**: `agent-browser`: (a) quattro card, layout regolare a larghezze desktop e a finestra stretta;
  (b) con una sola variabile ⇒ *"Mancante"* col nome giusto; (c) con entrambe ⇒ *"Configurata"*; (d) build +
  typecheck. (A5 e A6 sul comportamento reale si verificano in M4, dove esiste un run che può fallire: P-22.)
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S6
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#E. Esito onesto e Cloudflare in Connessioni]]
- **relation_mode**: body-links
- **tdd_target**: Con solo il token impostato, la card Cloudflare dice "Mancante" nominando
  `CLOUDFLARE_ACCOUNT_ID`.
- **review_mode**: browser

### T20: Client, richieste e verifica manuale — A2, A8, Constraints

- **depends_on**: [T19]
- **location**: `src/cloudflare/client.ts` (nuovo), `src/cloudflare/requests.ts` (nuovo),
  `scripts/cloudflare-smoke.ts` (nuovo), `package.json`, `README.md`, `tests/cloudflare-client.test.ts`
- **description**: Client con `fetch` **iniettato** (come `createApolloClient`): avvio del crawl, stato,
  annullamento; errori `config:` per le credenziali e `actor:cloudflare:<op>:` per il resto (P-14); mai il
  token nei log né i contenuti letti (D11). Percorsi e corpi **solo** in `requests.ts`.
  `npm run cloudflare:smoke`: **lo lancia l'utente con conferma esplicita**, legge un sito una volta e riporta
  pagine lette, forma del contenuto, consumo dichiarato dalla risposta e l'errore leggibile con permessi
  insufficienti (A8). **Scopo dichiarato** (Constraints): la verifica deve accertare *cosa* la lettura dichiara
  al sito (user agent, eventuale identificazione) e *se e come* l'endpoint rispetta i limiti che il sito
  espone; quanto emerge va scritto nel README accanto ai limiti di piano, e ciò che l'endpoint **non** fa per
  noi diventa un requisito di T23. README: permesso richiesto dal token, piano sufficiente, limiti del
  gratuito e cosa succede superandoli (A2), **con le parole che l'utente ritroverà negli avvisi del job**.
  Dopo lo smoke,
  correggere il tetto di pagine, i percorsi e le parole del limite ai valori **veri** (OQ-2, §8): finiscono
  testualmente nell'anteprima e nell'esito.
- **validation**: vitest con `fetch` finto e fixture: (a) crawl riuscito ⇒ pagine e testo mappati; (b) 401 ⇒
  errore attribuito a Cloudflare, leggibile; (c) limite di piano superato ⇒ messaggio a parole, non un codice;
  (d) il token non compare in nessun errore né riga di log; (e) senza credenziali il client non chiama
  (nessuna invocazione del `fetch` finto); (f) la richiesta costruita da `requests.ts` porta lo scopo
  dichiarato che lo smoke ha confermato. **Lo smoke reale lo esegue l'utente** e i suoi numeri — inclusi scopo
  dichiarato e limiti rispettati — entrano nel log del task e nel README.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S6
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#A. Cloudflare come quarto strumento]]
- **relation_mode**: body-links
- **tdd_target**: Con un `fetch` iniettato che risponde 401, il client produce un errore attribuito a
  Cloudflare e leggibile, senza il token nel messaggio.
- **review_mode**: cli

### T21: Attribuzione degli errori ed emendamento H2 — A6, H2

- **depends_on**: [T20]
- **location**: `src/runs/tools.ts`, `src/jobs/errors.ts`, `AGENTS.md`, `CLAUDE.md`,
  `tests/runs-tools.test.ts`
- **description**: (1) `toolNamedBy` riconosce `actor:cloudflare:` (P-14): oggi un `actor:<id>:` senza slash e
  diverso da `apollo` va ad **Anthropic** quando il run usa Anthropic, e la generazione usa sempre Anthropic.
  (2) **Attribuzione dei fallimenti per fonte** (P-26): `failedTools` oggi restituisce l'insieme vuoto se il
  run non è `failed`, ma C12 tiene le fonti isolate — una generazione col sito non letto **riesce**. Senza
  questa aggiunta A6 non è raggiungibile da nessun flusso che la spec permetta. Il run resta riuscito (C12 non
  cambia): l'esito porta gli strumenti delle fonti fallite, e chi calcola la salute di uno strumento
  (`connections()` / gli avvisi della home) li unisce a quelli di `failedTools`. (3) **Emendamento H2**
  (P-19): `AGENTS.md` e `CLAUDE.md` alla radice passano da tre a quattro strumenti esterni, anche nell'elenco
  "mai chiamare i servizi reali".
- **validation**: vitest puro: (a) `failedTools` su un run a quattro strumenti con errore
  `actor:cloudflare:crawl:` ⇒ **solo** `cloudflare`; (b) lo stesso run con un errore del modello ⇒ solo
  `anthropic`; (c) un errore non attribuibile ⇒ tutti gli strumenti del run; (d) **un run `succeeded`** il cui
  esito dichiara il sito non letto per Cloudflare ⇒ Cloudflare risulta non sano, gli altri tre sani, e il run
  resta riuscito (P-26); (e) lo stesso run senza fonti fallite ⇒ nessuno strumento non sano. `grep` su
  `AGENTS.md`/`CLAUDE.md` ⇒ Cloudflare presente in entrambi gli elenchi.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S6
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#A. Cloudflare come quarto strumento]]
- **relation_mode**: body-links
- **tdd_target**: Un run **riuscito** il cui esito dice che il sito non è stato letto fa risultare non sano
  **solo** Cloudflare.
- **review_mode**: cli

### T22: Chiusura M3

- **depends_on**: [T21]
- **location**: `tests/e2e/smoke-profile.md`, `README.md`
- **description**: Chiusura di tappa. **Nessuno smoke e2e proprio** (P-22): A5 e A6 sul comportamento reale si
  verificano in M4. Qui: 4 gate, i numeri veri dello smoke di T20 nel README, e il riepilogo all'utente che
  dice esplicitamente cosa questa tappa **non** ha ancora reso visibile.
- **validation**: 4 gate verdi; nessuna chiave nei log; README allineato ai numeri di T20.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S6
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#A. Cloudflare come quarto strumento]]
- **relation_mode**: body-links
- **tdd_target**: n/a (tappa).
- **review_mode**: cli

### M4 — Generazione e proposta

### T23: Lettura delle quattro fonti — C1–C5, C8, C10–C14

- **depends_on**: [T22]
- **location**: `src/profile/sources.ts` (nuovo), `src/cloudflare/requests.ts`,
  `tests/profile-sources.test.ts`, `tests/fixtures/profile/*`
- **description**: Quattro letture, ognuna una funzione pura sopra una dep iniettata, ognuna che scrive la sua
  riga `profile_sources` con esito e motivo: **profilo LinkedIn** (`ACTORS.profileDetail`, C3), **sito**
  (Cloudflare, tetto `CLOUDFLARE_MAX_PAGES` e i percorsi confermati da T20, C5, **con** lo scopo dichiarato e i
  limiti del sito rispettati per quanto T20 ha accertato non faccia già l'endpoint — Constraints), **post**
  (solo `text_complete = 1`, coi due conteggi di C8), **record d'impresa** (`enrichOrganizationsRequest` per
  **dominio**, C10: un dominio sconosciuto non consuma crediti). La **freschezza** (C4/G-4, 90 giorni) si
  confronta con l'**indirizzo letto**, tenuto in `meta`, non solo col tipo di fonte: `profile_sources` ha una
  riga per tipo, quindi cambiando il proprio URL o il sito una lettura vecchia sopprimerebbe in silenzio la
  lettura di un indirizzo **diverso**. Fonti **isolate** (C12); un sito senza contenuto utile produce l'avviso
  di C14 e **nessun valore dedotto**. **B9**: nessuna scrittura tocca `companies` — il record Apollo vive con
  il profilo.
- **validation**: vitest con deps finte e fixture: (a) ogni fonte letta ⇒ riga con `outcome='read'` e meta
  coerente; (b) sito vuoto o con consenso obbligatorio ⇒ `outcome='empty'` col motivo, nessun contenuto; (c)
  Cloudflare 401 ⇒ `outcome='failed'`, le altre tre lette comunque; (d) dominio sconosciuto ⇒
  `outcome='empty'`, zero crediti; (e) senza dominio ⇒ `outcome='unavailable'` col motivo di C11; (f) profilo
  letto 10 giorni fa ⇒ salta senza chiamare, e con la forzatura chiama; (g) profilo letto 10 giorni fa **ma con
  l'URL cambiato dopo** ⇒ **legge**, perché la freschezza è sull'indirizzo (idem per il sito); (h) `COUNT(*)`
  e contenuto di `companies` **invariati** dopo una lettura completa delle quattro fonti (B9).
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S7
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#C. Le fonti pubbliche]]
- **relation_mode**: body-links
- **tdd_target**: Con Cloudflare che risponde 401, le altre tre fonti vengono lette e l'esito dice quale è
  fallita e perché.
- **review_mode**: cli

### T24: Il kind, i blocchi e l'esito neutro — D1, D6–D14, H6

- **depends_on**: [T23]
- **location**: `src/jobs/generate-profile.ts` (dallo stub al reale), `src/server/routes/profile.ts`,
  `src/jobs/fake-deps.ts`, `tests/jobs-generate-profile.test.ts`
- **description**: Ordine imposto dall'UX (§8): **prima i casi degradati**, perché *"Pronte 2 fonti su 4"* è lo
  stato del primo giorno. Il kind passa da stub a reale (`Deps`, `handler`, `realDeps`, `configBlockers`,
  `previewFromParams`, `toolsOf`) **senza toccare il registry**, che T1 ha già cablato.
  `planGenerateProfile` → anteprima: blocker chiave Anthropic (D6) e "nessuna fonte / tutte escluse" (D7),
  avvisi **per fonte** (D8) più la proposta pendente (E11), esclusione di singole fonti e forzatura della
  rilettura (D9). **Contratto degli avvisi** (P-28): un motivo che appartiene a una fonte vive **solo** nella
  lista strutturata delle fonti; `warnings` porta solo ciò che non appartiene a nessuna fonte. Così "ogni
  avviso una volta sola" (FLOW B.3) è una regola dell'API, non una deduplicazione a confronto di stringhe nel
  frontend. Log: una riga per chiamata a uno strumento, con fonte e strumento, **mai** contenuti (D10,
  D11). Esito a tre toni (D13) e, **se nessuna fonte produce contenuto, il modello non si chiama**: nessuna
  spesa, nessuna proposta, la pendente intatta (D14). Retry dalla stessa anteprima (D12).
- **validation**: vitest: (a) blocker Anthropic; (b) tutte le fonti escluse ⇒ blocker; (c) secondo avvio ⇒ 409
  `job_running`; (d) tutte le fonti vuote ⇒ il client del modello **non** viene chiamato, nessuna proposta, la
  pendente invariata; (e) `retry-preview` = preview di route (conteggi, stima, avvisi, blocchi) **prima** che
  "Riprova…" sia esposto; (f) `toolsOf` dichiara solo gli strumenti delle fonti scelte; (g) il log ha una riga
  per chiamata e nessun contenuto; (h) una fonte fallita ⇒ esito "Attenzione" con le altre lette, **e** l'esito
  dichiara lo strumento di quella fonte (è ciò che T21 legge per la salute, P-26); (i) nessun motivo di fonte
  compare **anche** in `warnings` (P-28).
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S8
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#D. Generazione: anteprima e spesa]]
- **relation_mode**: body-links
- **tdd_target**: Con tutte le fonti senza contenuto, il job chiude neutro e il client del modello non viene
  mai chiamato.
- **review_mode**: cli

### T25: La stima: prima "non disponibile", poi il prezzo — D2, D3, D4, D5

- **depends_on**: [T24]
- **location**: `src/jobs/generate-profile.ts`, `src/config.ts`, `tests/jobs-generate-profile.test.ts`
- **description**: (§8) Prima il percorso senza prezzo, che è quello che il `.env` reale può avere: unità
  sempre vere (letture, pagine, crediti) e `est_cost_usd: null` ⇒ **"stima non disponibile"**. Poi il costo per
  fonte dichiarato una per una (D3, D4): profilo LinkedIn (prezzo dell'actor), record Apollo (crediti),
  elaborazione (`PRICE_PROFILE_GENERATION_USD`); sito e post non costano denaro.
- **validation**: vitest: (a) senza `APOLLO_CREDIT_USD` né `PRICE_PROFILE_GENERATION_USD` ⇒
  `est_cost_usd: null` con le unità ancora vere nei `counts`; (b) con i prezzi ⇒ somma corretta per fonte; (c)
  escludere una fonte ⇒ conteggi e stima coerenti; (d) mai un numero quando un pezzo non ha prezzo.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S8
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#D. Generazione: anteprima e spesa]]
- **relation_mode**: body-links
- **tdd_target**: Senza le variabili di prezzo, l'anteprima dichiara "stima non disponibile" e i conteggi di
  letture e crediti restano veri.
- **review_mode**: cli

### T26: Elaborazione del modello e proposta salvata — E1, E2, E5, E6, E11, E13

- **depends_on**: [T25]
- **location**: `src/profile/generate.ts` (nuovo), `src/profile/schema.ts` (nuovo), `src/config.ts`
  (`PROFILE_MODEL`), `.env.example`, `tests/profile-generate.test.ts`
- **description**: Prompt e schema strutturato della proposta (in italiano, E13), modello da `PROFILE_MODEL`
  con default `ANALYSIS_MODEL` (G-3). La risposta valida diventa **una** riga `profile_proposals` che
  sostituisce la pendente (E11) e **non tocca nessun valore** (E1). Solo i campi **generabili**, mai gli input
  (E2). Ogni voce cita le fonti (E5); una voce senza fonte o un secondo servizio con nome colliso **non entra**
  e si conta nell'esito (E6). Risposta non conforme ⇒ errore leggibile, mai un profilo a metà.
- **validation**: vitest con client finto: (a) risposta valida ⇒ una riga, i valori del profilo **invariati**;
  (b) risposta che propone `own_profile_url` o `website_url` ⇒ scartata (E2); (c) voce senza fonti ⇒ fuori,
  contata; (d) due servizi omonimi nella stessa proposta ⇒ il secondo fuori, contato; (e) risposta non
  conforme ⇒ errore leggibile, nessuna riga, pendente intatta; (f) seconda generazione ⇒ **una** sola riga
  pendente; (g) `PROFILE_MODEL` assente ⇒ usa `ANALYSIS_MODEL`, impostato ⇒ usa il proprio.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S8
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#E. La proposta]]
- **relation_mode**: body-links
- **tdd_target**: Una generazione riuscita crea la proposta e **nessun** valore del profilo cambia.
- **review_mode**: cli

### T27: La proposta in sola lettura: confronto e conflitti — E3, E4, E9

- **depends_on**: [T26]
- **location**: `src/db/profile-proposal.ts` (nuovo), `src/server/routes/profile.ts`,
  `tests/api-proposal.test.ts`
- **description**: (§8) **Sola lettura, prima di qualunque apply**: nessuna versione intermedia di "Applica
  tutto" deve poter toccare un valore scritto a mano. `GET /api/profile/proposal` **ricalcola il confronto
  adesso** (P-12): per ogni campo valore attuale e proposto (E3), per ogni servizio nuovo/modificato/invariato
  sui nomi normalizzati (E4), e **in conflitto** quando la voce ha provenienza `manual` (E9) — i tre campi
  legacy **non** ce l'hanno, quindi non sono conflitti (G-11), ma la risposta porta il loro conteggio perché
  la testata lo dichiari. La risposta dice anche perché "Applica tutto" sarebbe disabilitato, quando tutte le
  voci sono conflitti.
- **validation**: vitest: (a) profilo vuoto ⇒ tutte le voci applicabili, zero conflitti; (b) due campi scritti
  a mano ⇒ marcati conflitto; (c) i tre campi legacy valorizzati ⇒ **non** conflitti, e il conteggio di G-11
  = 3; (d) servizio eliminato dopo la generazione ⇒ alla lettura torna "nuovo", nessun errore; (e) rinominato
  a mano ⇒ conflitto; (f) tutte le voci in conflitto ⇒ la risposta lo dichiara col motivo.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S9
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#E. La proposta]]
- **relation_mode**: body-links
- **tdd_target**: Su un profilo con due campi scritti a mano, la lettura della proposta li marca come
  conflitti e lascia applicabili gli altri.
- **review_mode**: cli

### T28: Applica, applica tutto, corse e scarto — E7, E8, E10, E11, E12, H3, H5

- **depends_on**: [T27]
- **location**: `src/db/profile-proposal.ts`, `src/server/routes/profile.ts`, `tests/api-proposal.test.ts`
- **description**: (§8) **Singolo apply prima di "Applica tutto"**, e le corse nello stesso task, perché il
  confronto si ricalcola a ogni lettura e la corsa è raggiungibile al primo uso con due tab. Un servizio
  modificato conserva i campi che la proposta non nomina e **il nome dell'utente** (E7). `apply {all:true}`
  applica **solo** le voci senza provenienza `manual` (E8, G-11). Ciò che non si applica resta (E10). `DELETE`
  scarta la proposta intera senza toccare nessun valore (E12). Nessuna scrittura automatica (H3).
- **validation**: vitest: (a) `apply` di un campo ⇒ scritto, con `origin='proposal'`, e alla rilettura la voce
  risulta invariata; (b) servizio modificato applicato ⇒ campi non nominati invariati, nome invariato; (c)
  `apply all` su profilo con due voci a mano ⇒ applica le altre, **non** le loro, che restano conflitti; (d)
  `apply all` con i tre campi legacy ⇒ li sostituisce (G-11); (e) `apply` su una proposta non più corrente ⇒
  errore dedicato, nulla scritto; (f) `apply` di un servizio eliminato nel frattempo ⇒ errore dedicato e
  confronto ricalcolato; (g) `DELETE` ⇒ profilo e servizi invariati.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S9
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#E. La proposta]]
- **relation_mode**: body-links
- **tdd_target**: Su un profilo con due campi scritti a mano, `apply {all:true}` applica solo gli altri e
  lascia i due come conflitti da decidere.
- **review_mode**: cli

### T29: Seed e2e e deps finte di M4

- **depends_on**: [T28]
- **location**: `src/jobs/fake-deps.ts`, `scripts/e2e-server.ts`, `tests/e2e/README.md`,
  `tests/fixtures/profile/*`
- **description**: Deps finte del kind (le quattro fonti + il modello) che restituiscono le **stesse fixture**
  dei test unitari, così i mapper girano davvero anche in e2e; trigger di fallimento per fonte (Cloudflare
  401, limite di piano, sito vuoto, dominio sconosciuto, risposta non conforme) e per "nessun contenuto". Due
  scenari seminati: profilo vuoto (percorso A) e profilo curato a mano (percorso C), quest'ultimo **con** i
  tre campi legacy senza provenienza, per provare G-11 sullo schermo.
- **validation**: `POST /api/e2e/reset|seed` ⇒ i due scenari si aprono; ogni trigger produce l'esito atteso;
  `npm test` verde.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S10
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/SPEC#Constraints]]
- **relation_mode**: body-links
- **tdd_target**: Con il trigger del limite di piano, la generazione finta chiude con l'esito "Attenzione" e le
  altre tre fonti lette.
- **review_mode**: cli

### T30: FE — card "Genera profilo e servizi" e anteprima per fonte — G3, G4, G5, D3–D9

- **depends_on**: [T29]
- **location**: `web/src/components/settings/GenerateCard.tsx` (nuovo),
  `web/src/components/JobPreviewDialog.tsx`, `web/src/components/settings/ServicesCard.tsx`,
  `web/src/components/settings/ProfileForms.tsx`, `web/src/routes/settings.profile.tsx`,
  `web/src/lib/jobs.ts`, `web/src/api/{client,types}.ts`
- **description**: Card `#genera` come da FLOW A.2 ed E.1: stato (*"Mai generato."* / *"Ultima generazione:
  …"*), riga che anticipa lo stato delle fonti, tabella **una riga per fonte** dell'ultimo esito con
  `caption`, avviso anticipato quando ci sono voci scritte a mano, CTA coi puntini. Anteprima: `fieldset`
  *"Fonti da leggere"* con una spunta per fonte disponibile e il costo nella label, le **non disponibili** come
  lista col motivo e il link (non checkbox disabilitate), *"Rileggilo comunque"* per la fonte fresca,
  riassunto e costo con `aria-busy` e annuncio `polite` a ogni esclusione. Gli avvisi che nominano una fonte
  vanno sulla sua riga, gli altri nel riquadro giallo: **ogni avviso una volta sola**, e il frontend non
  deduplica niente perché l'API li separa già (P-28). **B9 come superficie**: dentro `#azienda`, il record
  d'impresa Apollo in **sola lettura**, chiuso di default, coi testi del FLOW — *"Letto il 20 set · … "* +
  *"Arriva da Apollo: non si modifica qui. Questa azienda non entra in Aziende, non è candidabile per un ICP e
  non si unisce a nessuna."* Qui arrivano anche i due testi provvisori di §10 che aspettavano la generazione: lo
  stato vuoto di `#servizi` e l'hint del sito.
- **validation**: `agent-browser`: (a) profilo vuoto ⇒ i testi di A.2 e *"Pronte 2 fonti su 4"*; (b) anteprima
  con quattro fonti ⇒ costi per fonte e totale; (c) escludere una fonte ⇒ conteggi, stima e annuncio
  aggiornati; (d) senza i prezzi ⇒ *"stima non disponibile"* con le unità; (e) blocker Anthropic ⇒ **Avvia**
  disabilitato col motivo e il link; (f) fonte fresca ⇒ spunta spenta e *"Rileggilo comunque"* la riaccende col
  costo; (g) nessun avviso duplicato; (h) il pannello del record Apollo è in sola lettura, chiuso di default,
  coi testi di B9; (i) **error path del FLOW**: caricamento della pagina fallito ⇒ `ErrorBox` + **Riprova**,
  con sidebar e ⌘K ancora usabili; job avviato e pagina ricaricata ⇒ il banner si ricostruisce da
  `/api/jobs/current` e la sezione Proposta compare al rientro; (j) tastiera e screen reader; (k) build +
  typecheck.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S8
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#B. L'anteprima con quattro fonti: costo per fonte, esclusioni, blocchi]]
- **relation_mode**: body-links
- **tdd_target**: Togliendo la spunta al record d'impresa, il riassunto passa a *"2 fonti"* e la stima scende,
  con l'annuncio della live region.
- **review_mode**: browser

### T31: FE — sezione Proposta — E3–E10, E12, G9, G10, G-11

- **depends_on**: [T30]
- **location**: `web/src/components/settings/ProposalSection.tsx` (nuovo),
  `web/src/routes/settings.profile.tsx`
- **description**: Sezione `#proposta` **sopra** le card che modificherebbe, con la testata dei conteggi e —
  quando ci sono campi compilati senza provenienza — la frase di G-11: *"N campi sono già compilati: Applica
  tutto li sostituisce."* Due gruppi (Campi del profilo · Servizi) e ordine per decisione (**In conflitto →
  Nuovo → Modificato → Invariato**). "Ora" e "Proposta" incolonnati in verticale come `dt`/`dd`; fonti in
  testo; conflitto col suo verbo (**Sostituisci il tuo testo**) e fuori da "Applica tutto", con l'hint prima
  del clic; toggle degli invariati col conteggio nel nome; focus alla voce successiva da decidere dopo ogni
  applicazione e live region; **Applica tutto** disabilitato col motivo in `aria-describedby` quando tutto è
  conflitto; scarto con conferma (G-10) e focus su **Annulla**. Deep-link `#proposta` senza proposta ⇒
  *"Nessuna proposta in attesa."*
- **validation**: `agent-browser`: i due percorsi del FLOW (A.5–A.6 e C.2–C.8) per intero, più: (a) tre campi
  legacy ⇒ la frase di G-11 nella testata e nessuno dei tre marcato conflitto; (b) tutte le voci in conflitto ⇒
  **Applica tutto** disabilitato col motivo; (c) applicare mentre un textarea ha modifiche non salvate ⇒ il
  toast dell'edge case e il testo ancora nel form; (d) due tab (applica in una, rigenera nell'altra) ⇒
  *"Questa proposta non è più quella corrente"*; (e) riavvio del server con proposta pendente ⇒ la sezione è
  ancora lì; (f) **error path del FLOW**: applica fallito per rete/500 ⇒ errore accanto alla riga
  (`role="alert"`), la riga resta da applicare e le altre invariate; scarto fallito ⇒ *"Proposta non scartata:
  …"* e la proposta resta; **proposta povera** ⇒ esito neutro coi suoi tre sbocchi gratis (**Aggiungi il
  sito** · **Sincronizza i post** · **Scrivi un servizio a mano**); (g) tastiera e screen reader; (h) build +
  typecheck.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S9
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#C. Giri successivi: la proposta su un profilo curato a mano]]
- **relation_mode**: body-links
- **tdd_target**: Su un profilo curato a mano, **Applica tutto** applica solo le voci non scritte a mano e il
  focus va al primo conflitto.
- **review_mode**: browser

### T32: FE — Oggi, banner ed esito — G6, OQ-7, D13

- **depends_on**: [T31]
- **location**: `src/db/today.ts`, `src/db/settings.ts` (`getReadiness` fornisce le chiavi che
  `setup_missing` filtra: senza toccarlo G6 e OQ-7 non sono implementabili),
  `web/src/components/SetupReminder.tsx`, `web/src/components/today/SetupAlerts.tsx`,
  `web/src/components/JobBanner.tsx`
- **description**: (§8, §9: **solo qui**, perché prima l'ancora `#genera` non esisterebbe). (1) `SETUP_KEYS`
  guadagna la voce della generazione, presente **solo** se il profilo non è mai stato generato **e** non
  esiste nessun servizio (G6); la voce `company` **tace** mentre la generazione è possibile (G-9, OQ-7). (2)
  `JobBanner`: kind *"Genera profilo e servizi"*, link d'esito **Rivedi la proposta** e **Dettagli del run**,
  **Riprova…** sui falliti. (3) Toast ed esito dicono le stesse cose del banner, in una riga.
- **validation**: `agent-browser`: (a) profilo vuoto con URL impostato ⇒ elenco a **due** voci, senza
  *"descrizione della tua azienda"*; (b) senza nessun indirizzo ⇒ torna la voce di oggi; (c) creato un servizio
  a mano ⇒ la voce della generazione sparisce; (d) generazione finita ⇒ banner e toast con **Rivedi la
  proposta**; (e) fallita ⇒ **Riprova…** riapre la stessa anteprima con le stesse fonti; (f) build + typecheck.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S9
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#Entry points]]
- **relation_mode**: body-links
- **tdd_target**: Con profilo vuoto e URL impostato, l'elenco "Da completare" mostra due voci e non
  *"descrizione della tua azienda"*.
- **review_mode**: browser

### T33: Smoke M4, A5/A6 sul vivo, documenti e consegna

- **depends_on**: [T32]
- **location**: `tests/e2e/smoke-profile.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`,
  `brain/specs/prospect-crm/own-profile-services/IMPLEMENTATION-NOTES.md` (nuovo),
  `brain/tech-debt/prospect-crm/own-profile-services.md` (se serve)
- **description**: (1) Smoke finale sui **cinque segnali di successo** del FLOW. (2) La verifica e2e che M3 non
  poteva fare (P-22, §9), ora **raggiungibile** grazie a P-26: una generazione che **riesce** con il sito non
  letto per Cloudflare fa diventare rossa **solo** la card di Cloudflare, con la riga *"«Configurata» vuol dire
  solo che la chiave è presente"*, mentre Apify, Apollo e Anthropic restano sane e il run resta riuscito (A5,
  A6, edge "Run di più strumenti"). Il trigger è quello seminato in T29. (3) **Emendamento H1** (P-19): `AGENTS.md` e `CLAUDE.md` alla radice non dicono più che
  l'AI serve solo all'analisi dei prospect; `README.md` con le fonti, i costi e le variabili nuove. (4)
  `IMPLEMENTATION-NOTES.md` con deviazioni e sorprese per il reviewer, e l'elenco di ciò che
  `docs-maintenance` deve ingerire al livello di dominio. Chiusura: `ux-advisor` sul prodotto girato
  (`UX-REVIEW.md`), poi **`adversarial-review` in una sessione nuova**.
- **validation**: smoke senza BLOCKER; 4 gate verdi; nessun segreto nei log; i cinque segnali di successo
  verificati uno per uno; A5/A6 verificati sul vivo.
- **status**: Planned
- **log**:
- **files edited/created**:
- **backlog_item_id**: OP-S10
- **backlog_item_url**: [[specs/prospect-crm/own-profile-services/FLOW#Goal]]
- **relation_mode**: body-links
- **tdd_target**: n/a (tappa).
- **review_mode**: browser

## 16. Gate di validazione per tappa

| Tappa | Gate per chiudere | Stop |
|---|---|---|
| **M1a** (T0–T7) | 4 gate verdi; ogni testo nuovo in italiano (G8); T2 senza differenze di conteggio né violazioni FK sulla copia reale, numeri riportati all'utente; **la seconda prova su una copia fresca dopo il backfill dell'impronta** (T3): `analyses` con `subject_hash IS NULL` = 0, conteggi invariati, `foreign_key_check` vuoto, e quante analisi risultavano "da aggiornare" prima e dopo — è l'unica scrittura del piano su righe esistenti e non chiude senza questo; smoke M1a senza BLOCKER (i due casi opposti di F7/F13, i due conteggi e il blocco di F8, il badge che sparisce e **ricompare** col testo nuovo); documenti di H7 allineati; reset dichiarato nei tre posti di P-20 | `implement-spec` si ferma: riepilogo, cosa provare, numeri di T2, **la dichiarazione del reset**, dove trovare il backup. Riparte col via dell'utente |
| **M1b** (T8–T12) | 4 gate verdi; ogni testo nuovo in italiano (G8); smoke M1b senza BLOCKER; regressione delle ancore `#profilo`/`#azienda` verde; copy provvisoria di §10 coerente con quanto dichiarato | Stop come sopra |
| **M2** (T13–T17) | 4 gate verdi; ogni testo nuovo in italiano (G8); prova F6 (input identico senza servizi) **e** regressione F7 su una modifica di servizio verdi; una sola funzione di stima usata da preview e card; smoke M2 senza BLOCKER | Stop come sopra |
| **M3** (T18–T22) | 4 gate verdi; ogni testo nuovo in italiano (G8); **verifica manuale di Cloudflare eseguita dall'utente** coi suoi numeri nel log di T20; README e anteprima allineati a quei numeri; nessuna chiave nei log; `failedTools` verde. **Nessuno smoke e2e** (P-22): dichiarato, non dimenticato | Stop come sopra, dicendo esplicitamente cosa non è ancora visibile |
| **M4** (T23–T33) | 4 gate verdi; ogni testo nuovo in italiano (G8, E13); smoke M4 senza BLOCKER; A5/A6 verificati sul vivo; i cinque segnali di successo del FLOW verificati; `IMPLEMENTATION-NOTES.md` scritto | Fine di `implement-spec` (`ux-advisor` → `UX-REVIEW.md`); `adversarial-review` in una **sessione nuova** |

## 17. Questioni aperte (non bloccanti)

| # | Questione | Default del piano |
|---|---|---|
| Q-1 | Il record Apollo del proprio dominio invecchia senza che nulla lo dica | Fuori scope (nessun automatismo): si rilegge alla prossima generazione, e l'esito per fonte ne mostra la data |
| Q-2 | La stima della generazione ha un prezzo da configurare (`PRICE_PROFILE_GENERATION_USD`) | Assente ⇒ *"stima non disponibile"* con le unità vere (D5), come per i crediti Apollo |
| Q-3 | `force` resta nei `params` di `analyze` ma nessun client in blocco lo manda più | Resta per l'analisi singola (F11); si toglie solo se un giorno cambia anche quella |
| Q-4 | Il tetto di 10 pagine potrebbe rivelarsi stretto o largo dopo T20 | Si corregge in `CLOUDFLARE_MAX_PAGES` e nel testo dell'anteprima, che legge la config |
| Q-5 | Lo stub di `generate_profile` vive nel registry per quattro tappe | Irraggiungibile (nessuna route fino a M4) e coperto da `NotImplementedError`; T24 lo sostituisce senza toccare il registry |
| Q-6 | Se il DB reale avesse servizi o campi nuovi già valorizzati, l'assunzione di F6 cadrebbe | T2 lo scopre sui conteggi della copia **prima** di toccare il DB vero |
| Q-7 | Un post di esattamente 301 caratteri che finisce davvero con `…` viene marcato troncato (P-24) | Accettato: l'errore cade dal lato prudente (il post non entra nella generazione) e si corregge al primo re-sync, che lo salva integrale |
| Q-8 | `PRICE_ANALYSIS_USD` sposta un numero dal codice al `.env`: chi non lo imposta vede la stima di oggi | Default = l'attuale 0,03, quindi nessun cambio visibile per chi non tocca il `.env` (P-27) |
