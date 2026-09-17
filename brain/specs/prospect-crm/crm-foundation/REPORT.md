---
domain: prospect-crm
type: review
scope: spec
spec: crm-foundation
review_target: "spec implementation"
base_ref: a6f203b
head_ref: "working tree non committato su main (2026-09-16)"
verdict: do-not-ship
review_impact: critical
human_in_loop: true
links:
  - "[[specs/prospect-crm/crm-foundation/RUBRIC]]"
  - "[[specs/prospect-crm/crm-foundation/PLAN]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW]]"
  - "[[specs/prospect-crm/crm-foundation/IMPLEMENTATION-NOTES]]"
ingested: false
last_ingested: null
created: 2026-09-16
updated: 2026-09-16
---

# Review Report: crm-foundation — pivot a CRM di prospecting LinkedIn

> Spec senza `SPEC.md` per scelta del PLAN: il contratto di accettazione è PLAN §12 (story CRM-S0…S8), la
> `validation` di ogni task (§13) e i percorsi di [[specs/prospect-crm/crm-foundation/FLOW|FLOW]].

## Verdict

**DO NOT SHIP** · impact: **critical** · human in the loop: **sì**

Obiezione più forte: il CRM non ha autenticazione per design e la sua unica protezione è restare in locale, ma
l'API ascolta su **tutte le interfacce** (`src/server/index.ts:22-28`): dalla LAN una verifica ha letto tutti i
prospect, scaricato i CSV e potuto avviare job a pagamento, contro la promessa del README e del contract. Insieme a
questo restano altri quattro BLOCKER indipendenti, tutti riprodotti con probe: il guard del server e2e che su macOS
cancella il DB reale con un `DB_PATH` a maiuscole diverse, il "Riprova" che avvia job a pagamento senza blocchi né
preview, l'aggancio per nome che salva l'id membro di un omonimo e porta poi a un merge irreversibile di due persone,
e un job di arricchimento che fallisce per intero su un solo campo inatteso.

## Coverage

- Rubric passes run: **16/16** — high (Opus-class, ereditato): v1, v2, v4, v5, v8, v9, v10, v11 · medium
  (Sonnet-class): v3, v6, v7, v12, v13, v14, v15, v16
- Passes skipped or failed: nessuno
- Solo v15 ha eseguito i gate completi (typecheck incl. `scripts/`, `npm test` 25 file / 238 test, build e typecheck
  web: tutti verdi); gli altri pass sono stati read-only con probe mirati su DB temporanei, mock locali dei provider e
  server e2e su porte dedicate (nessuna chiamata reale ad Apify/Anthropic, `data/` mai toccata).
- Verdetti: **SHIP** v2, v3, v7, v8, v9, v12, v13, v14, v15, v16 · **DO NOT SHIP** v1, v4, v5, v6, v10, v11.

## Findings

_"Durable?" = sì quando il finding non verrà corretto prima dello ship e va portato in `tech-debt/` all'ingest. I
BLOCKER e i MAJOR vanno corretti prima dello ship (no); i MINOR/NIT sono candidati tech-debt salvo correzione._

### BLOCKER

| # | Concern (verifier) | Location | Problem | Required fix / evidence | Durable? |
|---|--------------------|----------|---------|-------------------------|----------|
| B1 | v10 — PII senza auth | `src/server/index.ts:22-28`, `scripts/e2e-server.ts:84` | `serve()` senza `hostname` → `@hono/node-server` ascolta su `*:<port>`. Probe: `lsof` → `TCP *:8870 (LISTEN)`; da `http://192.168.1.131:8870` `GET /api/prospects` restituisce i dati personali, `GET /api/exports/1.csv` 200, job avviabili. Contraddice `README.md:113` e il contract ("esposizione remota fuori scope"). | `hostname: process.env.HOST ?? '127.0.0.1'` in entrambi i `serve()`; proxy Vite di default su `http://127.0.0.1:8787`. Verifica: `lsof` mostra solo `127.0.0.1`, curl dall'IP di LAN rifiutato. | no |
| B2 | v11 — protezione del DB reale | `scripts/e2e-server.ts:23-31` (+ check inutile a `:52`) | Guard `data/` = confronto di stringhe case-sensitive dopo `fs.realpathSync` (che conserva il case digitato) su APFS case-insensitive: `DATA/crm.db`, `Data/crm.db`, `link/../DATA/crm.db` e l'alias `/System/Volumes/Data…/data/crm.db` passano, e la riga 31 `rmSync` cancella `data/crm.db`, `-wal`, `-shm` all'avvio. Probe sulla copia invariata dello script con file esca: tre file cancellati in ogni variante. | Guard importabile che confronta `dev:ino` dell'antenato esistente più vicino con `root/data`, usato prima di `rmSync` e in `assertE2eDatabase` (`src/jobs/fake-deps.ts:462-463`); test vitest per case, symlink, sottocartella inesistente, alias. | no |
| B3 | v5 — controllo della spesa | `src/server/jobs.ts:200-207`, `src/server/routes/jobs.ts:27-34`, `web/src/components/JobBanner.tsx:78`, `web/src/routes/settings.tsx:508` | `POST /api/jobs/:id/retry` avvia qualunque kind senza i blocchi di configurazione e senza preview. Probe: senza `ANTHROPIC_API_KEY` l'avvio diretto dà 400 `blocked`, il retry 202; un analyze di lista ri-pianifica a runtime (preview 2 target / $0,06 → run 40 / $1,20); il retry senza chiave ha pagato 3 profile-detail prima di fallire (`src/jobs/analyze.ts:274-299`, chiave verificata solo a `:368-371`). Escala **TD-17**. | Blocchi di configurazione del kind anche nel retry (400 `blocked`); "Riprova" passa dalla preview del kind (o si congelano gli id risolti nei `params` al lancio); `analyzeMany` fallisce subito se manca la chiave. | no |
| B4 | v1 — identità e merge | `src/db/identity.ts:69-80,99,112-117,202-206`, `src/db/prospects.ts:122`, `src/jobs/enrich.ts:216-219` | L'aggancio per nome+headline (`nameTwin`) scrive come `member_urn` l'id membro di un **omonimo**; l'arricchimento non lo corregge (riempie solo se vuoto) e, arricchendo la persona vera, `setProspectIdentity` trova la riga sbagliata per `member_urn` e la **unisce**, portando stato, touchpoint e liste — un job che cambia stato e liste di una persona reale, senza undo. Probe A1–A4 (due "Marco Rossi · CEO"); fuzz con omonimi: 32/400 e 35/400 esecuzioni con due persone mescolate (0/800 senza omonimi). | Non persistere `member_urn` da un aggancio per nome (collegare solo la fonte) o registrarne la provenienza; in arricchimento l'id restituito dal provider per quel prospect è autorevole (sostituisce un id discordante, mai merge su un id contraddetto); test con omonimi. | no |
| B5 | v6 — adapter Apify | `src/jobs/enrich.ts:182,264-286,376-400`, `src/enrich/profile-detail.ts:82` | `enrichOne` protegge solo la chiamata al provider; `applyEnrichment` non è isolato e `matchCompanyId` esegue `e.company?.trim()` su un campo letto senza type guard. Un `current_company` non stringa (drift di schema) lancia `TypeError`, rigetta `Promise.all` e il job intero diventa `failed` con `process:` generico, senza conteggi, mentre altri profili sono già scritti. Probe riprodotto; nessun test copre la fase di applicazione. | try/catch attorno ad `applyEnrichment` con conteggio in `counts.errors`; `typeof === 'string'` nel mapper; test di isolamento. | no |

### MAJOR

| # | Concern (verifier) | Location | Problem | Required fix / evidence | Durable? |
|---|--------------------|----------|---------|-------------------------|----------|
| M1 | v10 (+ v8 fuori charter) — PII senza auth | `src/server/app.ts:25-28`, `src/server/http.ts:24`, `src/server/routes/sync.ts:45-46` | Nessun controllo Host/Origin e `readJson` accetta qualunque Content-Type: POST cross-site `text/plain` da `https://evil.example` → bulk status 200 (`updated:3`), export `markContacted` 201, sync con body vuoto 202 (spesa); `Host: evil.example` → 200 con PII (DNS rebinding). Vale anche con bind su loopback. | Middleware iniziale: 403 se Host non è `localhost/127.0.0.1:<port>`; per i non-GET richiedere `application/json` e Origin assente o locale (es. `hono/csrf` con allow-list). | no |
| M2 | v10 — PII di terzi | `tests/profile-detail.test.ts:10-16`, `tests/fixtures/apimaestro-profile-posts.json`, `tests/post-extract.test.ts:70`, `tests/apimaestro-actors.test.ts:16`, `PLAN.md:46` | Repository **pubblico** con dati reali di persone (nome, gmail, slug LinkedIn, URN, foto `media.licdn.com`, testo dei post) in test e fixture che questo cambiamento modifica o usa. Preesistenti a `a6f203b`, ma toccati qui. | Sostituire con dati fittizi ora; decidere se riscrivere la storia git; annotare il residuo in tech-debt. | no |
| M3 | v4 (+ v2 MINOR) — job e concorrenza | `src/db/index.ts:11-13`; transazioni in `src/db/prospects.ts:107,166`, `src/db/activities.ts:119`, `src/db/analyses.ts:123`, `src/jobs/sync-interactions.ts:372`, `src/jobs/enrich.ts:201`, `src/db/identity.ts:146,190` | `busy_timeout` non copre le transazioni deferred read-then-write (tutte): `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` immediati tra server e processo figlio. Probe: scrittore caldo vs `changeStatus` 95/963 errori, vs `saveAnalysis` 191 errori; scenario realistico 0–1 su ~190 per run. Effetti: 500 sulle azioni utente, analisi pagata persa (`src/analysis/analyze.ts:223`), job analyze/enrich falliti per intero, pagina di sync ripagata. Il commento di `db/index.ts` è falso. | `db.transaction(fn).immediate()` per le transazioni di scrittura + catch per item negli handler; correggere il commento. | no |
| M4 | v4 — job e concorrenza | `src/server/jobs.ts:70-78,86-92` | La guardia "pid vivo" si fida di qualunque pid vivo (anche `EPERM`): una riga `running` rimasta dopo un crash del server con pid riusato blocca **tutti** gli avvii e i retry (409) indefinitamente, senza alcuna via di recupero in app. Probe con pid 1 → `running`, retry 409; su questo Mac il contatore dei pid ha già fatto il giro. | Verificare l'identità del processo (`ps` con `job-entry.ts <id>` o `lstart` ≥ `started_at`), far registrare a `job-entry` il proprio `process.pid`/heartbeat, azione in app "segna come interrotto". | no |
| M5 | v5 — spesa | `src/analysis/analyze.ts:189-196`, `src/jobs/enrich.ts:288-300`, `web/src/components/AnalysisCard.tsx:85,94-97` | "Arricchisci e analizza" ripaga profile-detail a ogni clic per un profilo già noto senza dati (`enrichOneInline` ignora la freschezza). Probe: 3 clic → 3 chiamate di enrichment, ognuna 409 `not_enrichable`; la preview di enrich per lo stesso prospect dice `skipped_fresh 1`. | 409 `not_enrichable` senza chiamare il provider se tentato entro `FRESHNESS_DAYS`; il ri-arricchimento a pagamento solo da `EnrichDialog` con `retryFailed`. | no |
| M6 | v5 — spesa | `src/jobs/sync-interactions.ts:185-198,205-207`, `web/src/components/SyncDialog.tsx:39,64` | Dopo il primo sync la stima somma solo i post noti e ignora quelli pubblicati nel frattempo, senza warning. Probe: stima $0,56, spesa reale ≈ $6,58 (12×). | Warning + limite superiore (`(postsPerSync − noti) × cap`) o `null` con l'azione `postsOnly` quando possono esserci post nuovi. | no |
| M7 | v5 — spesa | `src/jobs/sync-interactions.ts:452-461` | I post sono marcati sincronizzati solo a fine job: un figlio interrotto o un fallimento parziale fanno ripagare reazioni e commenti già salvati (probe B: 100 reazioni riscaricate; probe A: reazioni del post 2 riscaricate). Contro FLOW "il retry non paga due volte i post ok". | Marcare ogni post subito dopo aver persistito reazioni e commenti (o tracciare i due progressi separati). | no |
| M8 | v6 — adapter | `src/jobs/source-company.ts:180-208` | Nessun isolamento per candidato: un errore DB su una persona interrompe l'intero sourcing (dichiarato nel log di T9, non in tech-debt), contro PLAN §5 "best-effort per item". | try/catch per candidato con conteggio `errors`. | no |
| M9 | v6 — adapter | `src/acquisition/mappers/reactions.ts:46-47`, `src/acquisition/mappers/posts.ts:112-113`, `src/db/prospects.ts:55-59` | `fullName`/`headline` di reazioni e commenti non protetti (a differenza di `employees.ts` con `str()`); `clean()` lascia passare i non-stringa → possibile crash di bind in SQLite su drift di schema (il sync isola solo a livello di post). | `str()` nei due mapper e/o `clean()` che scarta i non-stringa. | no |
| M10 | v1 — identità (escala **TD-1**) | `src/db/identity.ts:60-62,93-95,198` | `ACoAA…` e `ACwAA…` della stessa persona non si uniscono **nemmeno dopo l'arricchimento**: `compatible()` confronta le stringhe e blocca il merge sullo slug canonico. Probe B: sourcing `giulia-test` + `ACwAA…` e reazione `ACoAA…` → arricchimento con lo stesso slug → `mergedIds: []`. Rompe FLOW.md:344 ("reazione + dipendente: un prospect") e la mitigazione dichiarata in TD-1. Le note legacy riportano 134 profili reali `ACwAA` da harvestapi (modo di default Short). Evidenza mancante: un item reale harvestapi Short e l'`urn` di profile-detail. | Id con prefisso di tipo diverso = non confrontabili (non in conflitto); in arricchimento vince lo slug canonico del provider. | no |
| M11 | v13 — FE acquisizione | `web/src/routes/index.tsx:26` | Il redirect `/` → `/inbox` richiede profilo + ICP + prospect; FLOW.md:55 (entry point) e l'edge case 335-337 ("DB vuoto ma profilo/ICP presenti → Inbox vuota con Sincronizza ora") chiedono solo profilo + ICP: l'edge case è irraggiungibile. Deviazione dichiarata nel log T13, mai portata in tech-debt. | Allineare la condizione al FLOW, oppure registrare la decisione e riconciliare il testo del FLOW. | no |

### MINOR

| # | Concern (verifier) | Location | Problem | Required fix / evidence | Durable? |
|---|--------------------|----------|---------|-------------------------|----------|
| m1 | v2 | `src/db/schema.ts:106,221`, `src/db/index.ts:14` | Nessun versioning dello schema: un `crm.db` senza `member_urn` fa fallire `applySchema` all'import (server, figlio e `db:init`); `ensureColumn` mai usato. Teorico oggi (nessun `data/crm.db`). | `PRAGMA user_version` + `ensureColumn` prima dell'indice. | sì |
| m2 | v2 (+ v4 NIT) | `src/config.ts:79`, `src/server/jobs.ts:106` | `DB_PATH=` vuoto → DB in memoria (dati persi, `db:init` dice ok); `DB_PATH` relativo risolto con cwd diversi tra server e figlio; il server di prodotto non impedisce di puntare a `data/sevedemo.db`. | `path.resolve(ROOT, env \|\| default)`; rifiutare `sevedemo*.db`. | sì |
| m3 | v11 | `scripts/e2e-server.ts:23,32` | Symlink + sottocartella inesistente (`/tmp/link/sub/crm.db` → `data/`) supera il guard e crea `data/sub/`. | Coperto dal guard `dev:ino` di B2. | sì |
| m4 | v11 | `src/jobs/fake-deps.ts:462-463` | Il guard di riserva di reset/seed è uno `startsWith` di stringhe (case, relativo, symlink passano). | Riusare il guard condiviso di B2. | sì |
| m5 | v11 | `src/jobs/deps.ts:11`, `src/config.ts:1` | `E2E_FAKE_JOBS=1` nel `.env` reale o nella shell attiva le deps fake nel server di prodotto su `data/crm.db` (profili sintetici e analisi di fixture scritti su prospect veri). | Rifiutare le deps fake con DB dentro `data/`, o attivarle solo da `scripts/e2e-server.ts`. | sì |
| m6 | v11 | `scripts/e2e-server.ts` | Il guard del percorso all'avvio è codice top-level senza test di regressione. | Estrarlo e testarlo (vedi B2). | sì |
| m7 | v4 + v9 | `src/apify/client.ts:24` | `.call(input)` senza `{ log: null }`: lo streaming dei log dell'actor scrive su console → dopo un restart del server il figlio muore di `EPIPE` (run Apify perso, "Riprova" ripaga); in un fallimento di rete all'avvio del run, rejection non gestita che stampa l'header `Authorization: Bearer <token>` nel terminale (non persistito). | `call(input, { log: null })`; opzionale handler `unhandledRejection` che logga solo il messaggio. | sì |
| m8 | v4 | `src/server/jobs.ts`, `src/db/jobs.ts:75-86` | Il pid salvato è il launcher `tsx`: un nipote orfano può finire dopo che il job è stato marcato `failed` e ribaltarlo a `succeeded`. | `job-entry` salva `process.pid` all'avvio. | sì |
| m9 | v3 + v14 + v16 | `src/server/routes/prospects.ts:138-149`, `src/db/lists.ts:157-175`, `FLOW.md:322` | Le azioni in blocco sono transazioni atomiche: il percorso FLOW "10 riusciti · 2 errori + Riprova i falliti" non è implementabile (un errore annulla tutto; la UI mostra l'errore e conserva l'intera selezione). | Isolamento per item con risultati per id, oppure decisione registrata e FLOW aggiornato. | sì |
| m10 | v10 | `src/exports/list-export.ts:313-319` | "Scarica di nuovo" re-invia prospect nel frattempo `scartato` o rimossi; l'export dell'intera lista include gli scartati; nessuna API per cancellare un prospect (richieste GDPR solo via SQL). | Escludere gli scartati al ri-download o avvisare; annotare il gap di cancellazione. | sì |
| m11 | v10 | `src/server/app.ts:30,50` | `/api/health` espone il percorso assoluto del DB; `onError` restituisce `err.message` grezzo sui 500. | Togliere `db` dalla risposta (o solo in dev); messaggio generico sui 500. | sì |
| m12 | v8 | `src/analysis/prompt.ts:122,132-134,180` | I delimitatori `<profilo>`/`<segnali>` sono falsificabili dal testo del profilo o dei commenti (probe con `</profilo>` e istruzioni finte). Mitigato: testo non fidato solo nel turno utente, output strutturato, nessun tool; impatto limitato a fit/angoli del prospect stesso (che però alimentano filtro fit e CSV). Nessun test. | Escape dei tag o boundary casuale / JSON; istruzione finale nel system prompt; test con `</profilo>` forgiato. | sì |
| m13 | v8 | `src/server/routes/prospects.ts:35`, `lists.ts:16`, `exports.ts:28`, `analyze.ts:22`, `enrich.ts:18`, `companies.ts:106` | `z.coerce.number()` negli id dei body JSON: booleani, array ed esadecimali accettati (probe `["0x1", true, [2]]` → `added 2`). | `z.number().int().positive()` nei body; coercizione solo per query/path. | sì |
| m14 | v5 | `src/jobs/analyze.ts:186-192` | Con prezzo profile-detail `null` e `to_enrich > 0` la preview di analisi restituisce comunque un `est_cost_usd` numerico (solo analisi) invece di `null`. | `null` con il warning, o stime separate. | sì |
| m15 | v5 | `src/jobs/source-company.ts:64`, `src/apify/actors.ts:87` | `EMPLOYEES_PER_COMPANY` da env non limitato: `0` → `maxItems:0` = "tutti fino a 2500" via API (la UI lo blocca). | Clamp/validazione 1–2500 del default. | sì |
| m16 | v5 | `src/enrich/profile-detail.ts:124-125`, `src/jobs/enrich.ts:165-176` | Item senza URL canonico leggibile scartati come "nessun dato" (drift → tutti non arricchibili, ripagati al retry); il timeout inline di 120 s abbandona un run forse fatturato. | Chiave sull'URL di input anche senza canonico + warning di esito sospetto. | sì |
| m17 | v1 | `src/db/identity.ts:153`, `src/exports/list-export.ts:307-319` | Il merge non riscrive `exports.prospect_ids`: dopo un merge il ri-download perde il prospect (probe: 1 riga → 0). | Sostituire `dropId` con `keepId` (dedup) nella transazione di merge. | sì |
| m18 | v1 | `src/util/fields.ts:28-48`, `src/db/identity.ts:29` | La chiave d'identità accetta qualunque path linkedin.com: `/company/acme/` crea un prospect, `/in/x/details/experience` un secondo prospect. | `normalizeProfileUrl` e rifiuto dei non `/in/`. | sì |
| m19 | v1 | `src/db/identity.ts:153-171` | Il merge scarta in silenzio i valori in conflitto del duplicato (email inserita a mano, `reaction_type` della fonte in conflitto). | COALESCE sulle fonti in conflitto prima del delete + nota con i valori scartati. | sì |
| m20 | v14 | `web/src/components/ProspectTable.tsx:113` | Tooltip delle fonti con `reaction_type` grezzo in inglese (LIKE, PRAISE) in Inbox e Lista; il dettaglio prospect ha già la mappa italiana (`prospects.$id.tsx:456-463`). | Helper di label condiviso. | sì |
| m21 | v13 | `web/src/components/JobBanner.tsx:153-163`, `web/src/routes/settings.tsx:639-663` | Nessun link a `/settings#profilo` nel recupero "profilo mancante" (FLOW Error paths); poco raggiungibile (bottone disabilitato). | Link nell'esito `config:` del profilo. | sì |
| m22 | v15 | `web/src/components/filters/emailOptions.ts:1-9`, `web/src/components/filters/FilterBar.tsx:22` | Commenti legacy che citano route cancellate (`contacts.index.tsx`, `selections.$date.tsx`) e il termine "Bucket". | Aggiornare i commenti. | sì |
| m23 | v16 | `tests/e2e/smoke.md`, `brain/tech-debt/prospect-crm/crm-foundation.md` | Le evidenze screenshot dello smoke (`t18-*.png`) non sono versionate: le prove FE non sono verificabili dal solo artefatto (mitigato da asserzioni testuali, deps fake strutturalmente identiche alle reali, suite verde). | Versionare un sottoinsieme di evidenze o accettare esplicitamente il limite. | sì |

### NIT

| Concern (verifier) | Location | Problem | Durable? |
|--------------------|----------|---------|----------|
| v2 | `src/db/schema.ts:158-159`, `tests/schema.test.ts` | Fonti `manual` con `post_id`/`company_id` sfuggono a `ux_sources_manual`; test FK (SET NULL/RESTRICT/CASCADE) e riapertura del file assenti. | sì |
| v7 | `src/analysis/schema.ts:43-68` | Lista delle keyword JSON schema rimosse verificata solo da unit test, non contro l'endpoint reale (fallimento rumoroso, non silenzioso). | sì |
| v8 | `src/server/http.ts:37-41`; `web/src/routes/settings.tsx:430`, `prospects.$id.tsx:495`; `src/db/companies.ts:42,113-116`; `src/util/csv.ts`; `src/util/fields.ts:35` | `idParam` accetta `1e0`/`0x1`; `post_url` e `website` senza allow-list di schema (solo React 19 blocca `javascript:`); LIKE non escapato nella ricerca aziende; CSV con spazio prima di `=`; host `evillinkedin.com` accettato (preesistente, riscritto a www.linkedin.com). | sì |
| v9 | `.gitignore:3` | Ignorato solo `.env`, non `.env.*` (preesistente). | sì |
| v10 | `.gitignore`; letterali di test | `data/` coperto solo dai pattern `*.db`; domini di test verosimili (`acme.it`, `johnsmith`). | sì |
| v12 | `src/server/routes/lists.ts:71-76`, `prospects.ts:135-151`, `icps.ts:91-98` | Corpi più ricchi di `{ok:true}` per add/remove/bulk; PUT upsert dei riferimenti sempre 200 (coerenti col client). | sì |
| v1 | `src/jobs/sync-interactions.ts:358-368`; `src/util/fields.ts` | Contatore `prospects_new` con righe che hanno assorbito un duplicato; slug NFC vs NFD diversi. | sì |
| v4 | `src/jobs/fake-deps.ts:483` | Il reset e2e riusa gli id dei job (finestra ≤ 500 ms). | sì |
| v5 | `web/src/components/AnalysisCard.tsx:97`; `tests/source-company.test.ts:9,260,278`; `routes/enrich.ts:20`, `routes/analyze.ts:24` | "Rianalizza" sempre `force:true`; POST di avvio nei test senza override di spawn; `MAX_IDS` 1000 lato server vs cap 500 di P9. | sì |
| v16 | `brain/index.md:35`, `brain/specs/prospect-crm/prospect-crm-specs.md:23` | `crm-foundation` ancora "In progress" (finalizzazione pendente). | no |

## What passed

| Concern (verifier) | Evidence |
|--------------------|----------|
| v1 — identità e merge | Nessun dedup su URL grezzi (scritture solo via upsert/applyIdentity/merge); normalizzazione case e percent-encoding; merge atomico in transazioni annidate; fuzz 3 × 7.500 operazioni: 0 eccezioni, 0 attività perse; figli spostati; regole di sopravvivenza, stato e `created_at`; job enrich/analyze e route gestiscono id spariti; 66 test mirati verdi. |
| v2 — schema e storage | 13 tabelle e colonne = PLAN §6 (incl. `member_urn`); tutti gli indici e i parziali; conflict target coerenti con le clausole `WHERE`; CHECK generati dalle costanti TS; ON DELETE verificati con probe; derivati calcolati in lettura; init idempotente; WAL + `busy_timeout` in entrambi i processi; `sevedemo.db` mai referenziato in `src/`. |
| v3 — stati e timeline | Solo 4 chiamanti di `changeStatus`, tutti da azioni utente; `status_change` scritto in un solo punto; nessun job/AI cambia stato o liste oltre la lista scelta nel sourcing; merge con storia degli stati tracciata; eliminazione solo di touchpoint/note; export `markContacted` atomico e idempotente; 49 test verdi. |
| v4 — job | Un solo job per server (`[202, 409]`); 409 anche sul retry; retry solo dei `failed` con params identici; entità cancellate → `config:`; figli crashati → `process:` con exit code; stato finale sempre scritto; guardia pid funzionante su macOS; reset/seed e2e 409 con job in corso. |
| v5 — spesa | Avvii diretti dei 4 kind e analisi singola (anche `enrichFirst`) → 400 `blocked`; `est_cost_usd` null al primo sync e con prezzo profilo nullo; start fee inclusa; cap reazioni e `maxItems`; cap 500 della selezione; cooldown/recency/force; freschezza nei job; skip su input identico; `JobPreviewDialog` e parità preview/avvio; test ed e2e non raggiungono provider reali. |
| v6 — adapter Apify | Input degli actor solo in `src/apify/actors.ts`; builder conformi a PLAN §7; `memberUrn` propagato ovunque; tolleranza ai layout alternativi testata (36/36); esiti zero/warning/errore onesti in sync e sourcing (51/51). |
| v7 — analisi AI | `output_config` + modello + `max_tokens` tipizzati sull'SDK 0.126 installato; parse zod; refusal/max_tokens/JSON invalido/timeout come attività senza crash (29/29); gate di profilo; `input_hash` e `stale` in un solo punto; stati di riga e filtri per ICP (13/13); estrazione del testo che ignora i blocchi di thinking; fallback `ANALYSIS_STRUCTURED=0`; 16.000 token compatibili col non-streaming. |
| v8 — injection | SQL solo con placeholder e allow-list; enum zod respingono injection su sort/status/fit/source (400); escape LIKE nella ricerca prospect; CSV con guard formule + RFC 4180 (probe); nessun HTML grezzo nel frontend; href LinkedIn normalizzati; fallback statico resistente a 14 tentativi di traversal. |
| v9 — segreti | Token Apify in header, mai in URL; errori ricostruiti dal solo messaggio; Anthropic 401/403/400/500 via servizio, route, job e `GET /api/jobs`: nessuna chiave; readiness solo booleani; env ai figli non loggato; e2e con `DOTENV_CONFIG_PATH=/dev/null` provato; `.env` ignorato, mai nella storia; nessun pattern di chiave nel repo. |
| v10 — PII | Vite dev solo localhost; `exports/`, `.env`, DB ignorati; export senza scritture su disco e `no-store`; scope CSV (intersezione lista, filtri, `hasEmail`, 400 sul mix) 9/9; colonne esatte senza telefono/raw/`member_urn`; nome file slug; nuove fixture fittizie; nessuna PII nei log; nota GDPR nel README. |
| v11 — DB reale | Guard rifiuta `data/crm.db` relativo/assoluto, `./data/../data`, sottocartelle, cartella symlink, `TMPDIR=data`; fallback in `$TMPDIR/crm-e2e-<port>`; `.env` ignorato dall'e2e ed ereditato dai figli; `/api/e2e/*` solo nello script e2e; DB temporaneo per processo vitest (probe); 18/18 `e2e-deps`. |
| v12 — contratto HTTP | Helper condivisi in tutti i router; 400 con `issues`; ogni `code` d'errore allineato server ↔ UI; 400 `blocked` vs 409 `job_running` uniforme; tipi web identici alle viste DB campo per campo; enum identici; ogni chiamata `api.*` risolve a una route esistente; 159 test mirati verdi. |
| v13 — FE acquisizione | Onboarding e copy; `SyncDialog`; `JobPreviewDialog` accessibile e disabilitato su blocchi/refetch; helper di esito allineati ai conteggi reali; `JobBanner` con Riprova e notifica una volta; `SourceCompanyDialog`; toaster a 4 toni con ruoli; duplicati e race 409; TD-2/8/9/10/11/13/22 confermati accurati. |
| v14 — FE triage | Filtri nell'URL con fallback; selezione persistente e cap 500 con copy FLOW; lista archiviata; scarta/ripristina; prospect unito/cancellato → vista non trovato; stati refusal/non arricchibile/errore; export con default, conteggio live, disabilitato a 0; accessibilità di dialog, live region, badge testo+colore, timeline semantica. |
| v15 — gate e purge | `npm run typecheck` (incl. `scripts/`) exit 0; `npm test` 25 file / 238 test; build web ok; typecheck web exit 0; `purge-guard`; `package.json`/`pnpm-lock` coerenti (SDK 0.126, zod 4.6.5, dipendenze tutte usate); `routeTree.gen.ts` non tracciato e rigenerato; nessun `LINKEDIN_LI_AT`; grep T17 vuoto; `.env.example` = variabili lette. |
| v16 — tracciabilità | CRM-S0…S8 mappate a test e passi dello smoke; deps fake strutturalmente identiche alle reali per i 4 kind; deviazioni dichiarate verificate nel codice (max_tokens, 409, from-url senza `listId`, path della preview di analisi); brain reset coerente e wikilink risolti; voci TD verificate accurate. |

## Per-concern verdicts

| Pass | Charter | Verdict | Rationale |
|------|---------|---------|-----------|
| v1 | Identità dei prospect e integrità del merge | DO NOT SHIP | Merge atomico e robusto, ma l'aggancio per nome salva l'id di un omonimo e porta a un merge irreversibile di due persone (B4); `ACoAA`/`ACwAA` mai unificati (M10). |
| v2 | Invarianti di schema e storage | SHIP | Schema, indici, CHECK e ON DELETE conformi a §6; difetti limitati (versioning, `SQLITE_BUSY_SNAPSHOT`, `DB_PATH`). |
| v3 | Invarianti degli stati di contatto | SHIP | Ogni cambio di stato è manuale e tracciato; unico gap l'isolamento per item del bulk. |
| v4 | Ciclo di vita e concorrenza dei job | DO NOT SHIP | Il ciclo normale regge; la guardia pid con pid riusato blocca tutto (M4) e `busy_timeout` non evita `SQLITE_BUSY` tra server e figlio (M3). |
| v5 | Controllo della spesa a pagamento | DO NOT SHIP | "Riprova" avvia job pagati senza blocchi né preview (B3); ri-pagamenti di enrichment e sync, stima del sync sottostimata (M5–M7). |
| v6 | Correttezza degli adapter Apify | DO NOT SHIP | Un campo inatteso fa fallire tutto il job di arricchimento con scritture parziali (B5); sourcing e mapper non isolati (M8, M9). |
| v7 | Correttezza dell'analisi AI | SHIP | Structured outputs, validazione, errori, staleness e stati per ICP verificati contro l'SDK reale; unico NIT sulle keyword dello schema. |
| v8 | Sink di injection | SHIP | SQL, CSV, rendering e static serving sicuri; delimitatori del prompt falsificabili e coercizione degli id sono MINOR. |
| v9 | Riservatezza dei segreti | SHIP | Nessuna chiave in DB, API, job, CSV o repo; stampa rara del token in terminale via log streaming (MINOR). |
| v10 | Esposizione di PII senza auth | DO NOT SHIP | API su tutte le interfacce (B1), CSRF/DNS rebinding (M1), PII reali nel repo pubblico (M2). |
| v11 | Protezione del DB reale | DO NOT SHIP | Una variante di maiuscole del `DB_PATH` supera il guard e cancella `data/crm.db*` all'avvio del server e2e (B2). |
| v12 | Contratto HTTP server ↔ client | SHIP | Nessuna divergenza di forma, codici o percorsi; solo due NIT stilistici. |
| v13 | UX FE di acquisizione e job | SHIP | Conforme a FLOW; redirect della home divergente (M11) e link di recupero mancante (MINOR). |
| v14 | UX FE di triage e contatto | SHIP | Conforme a FLOW e accessibile; tooltip reazioni in inglese e bulk non parziale (MINOR). |
| v15 | Build, tooling e purge del legacy | SHIP | I quattro gate verdi; dipendenze e configurazioni coerenti; solo commenti legacy (MINOR). |
| v16 | Tracciabilità dell'accettazione | SHIP | Story e validazioni coperte da test e smoke; gap del bulk parziale e screenshot non versionati (MINOR). |

## Human Review Checklist

_Obbligatoria (impatto critical). Nessun commit, push o uso su dati reali prima di averla completata._

1. **Non pubblicare nulla finché i punti 2 e 3 non sono chiusi.** Il repository GitHub è **pubblico**: prima di qualunque
   push, verifica che nessun file di test contenga dati di persone reali (M2) e decidi se riscrivere la storia git per
   quelli già pubblicati (`tests/fixtures/apimaestro-profile-posts.json`, `tests/profile-detail.test.ts`, …).
2. **Esposizione in rete (B1).** Dopo la correzione avvia `npm run api` e controlla con
   `lsof -iTCP:8787 -sTCP:LISTEN -n -P` che l'indirizzo sia solo `127.0.0.1`; da un altro dispositivo della stessa rete
   `http://<ip-del-mac>:8787/api/health` deve fallire. Fino ad allora non avviare il CRM su reti non fidate.
3. **Richieste cross-site (M1).** Con il server locale acceso:
   `curl -i -X POST -H 'Origin: https://evil.example' -H 'Content-Type: text/plain' --data '{"prospectIds":[1],"status":"contattato"}' http://127.0.0.1:8787/api/prospects/bulk/status`
   deve rispondere 403 (su un DB di prova, mai su `data/`).
4. **Protezione del DB reale (B2, m3–m6).** Verifica il nuovo guard **solo con file esca** fuori da `data/` (es. una
   copia dello script in una cartella temporanea con una sua `data/`), provando `DATA/crm.db`, un symlink e una
   sottocartella inesistente: lo script deve rifiutare di partire e i file esca devono sopravvivere. Non eseguire mai
   la prova contro la `data/` del repository.
5. **Riprova e spesa (B3, M5–M7).** Con `npm run e2e:server` e `E2E_NO_ANTHROPIC=1`: un job di analisi fallito con
   "Riprova" deve dare 400 `blocked` o aprire la preview, mai partire; "Arricchisci e analizza" su un profilo senza dati
   non deve chiamare di nuovo il provider; un sync interrotto non deve riscaricare i post già completati.
6. **Identità (B4, M10).** Esegui (o fai aggiungere) un test con due omonimi con stessa headline: dopo sync e
   arricchimento devono restare **due** prospect distinti con stati e liste propri. Per `ACoAA`/`ACwAA` decidi se
   raccogliere un'evidenza reale con un run minimo a pagamento (harvestapi Short, `maxItems` 3 e un solo profile-detail)
   — è una spesa reale, quindi va autorizzata esplicitamente.
7. **Isolamento dei job (B5, M8, M9).** Verifica con test che un profilo o un dipendente con un campo inatteso produca un
   solo errore conteggiato e che il job termini `succeeded` con il riepilogo.
8. **Concorrenza (M3, M4).** Con un job lungo in corso (`E2E_FAKE_DELAY_MS=20000`) esegui cambi di stato ripetuti:
   nessun 500. Simula una riga `running` con un pid vivo estraneo: deve esistere un modo in app per sbloccarla.
9. **Decisione UX (M11).** Scegli se la home deve reindirizzare a `/inbox` con solo profilo + ICP (FLOW) o restare
   com'è, e aggiorna codice o FLOW di conseguenza.
10. **Gate del progetto** (da `AGENTS.md`), tutti verdi: `npm run typecheck`, `npm test`,
    `npm --prefix web run build`, `npm --prefix web run typecheck`.
11. **Rieseguire l'adversarial-review** su questo spec folder (nuovo round) e procedere solo con verdetto SHIP; poi
    `docs-maintenance` per l'ingest di spec, report e tech-debt.
12. **Primo uso reale** (dopo lo SHIP): smoke manuale a cap minimi come da PLAN §14 W3 (`POSTS_PER_SYNC=1`,
    `REACTIONS_PER_POST=20`, `maxItems=3`, un'analisi) su un DB nuovo, controllando i costi reali nella console Apify e
    Anthropic.

## Acceptance criteria check (case B)

| Criterion | Met / Unmet / Blocked | Notes |
|-----------|-----------------------|-------|
| CRM-S0 — Pivot: rimozione Lead Engine e reset del brain (T1, T2, T3, T17) | Met | Gate verdi, purge completa, brain coerente (v15, v16); solo commenti legacy (m22). |
| CRM-S1 — Azienda e ICP con aziende di riferimento (T4, T14) | Met | Test API e UI conformi (v12, v13, v16). |
| CRM-S2 — Profilo e prospect da reazioni/commenti (T7, T8, T14, T20, T18) | **Unmet** | Merge errato tra omonimi (B4); `ACoAA`/`ACwAA` non unificati (M10); stima del sync sottostimata (M6) e ri-pagamento dopo interruzione (M7); "Riprova" senza blocchi (B3). |
| CRM-S3 — Persone dalle aziende filtrate per ruoli ICP (T7, T9, T19) | Met con riserve | Flusso e UI conformi; manca isolamento per candidato (M8); retry non controllato (B3). |
| CRM-S4 — Liste per ICP e triage dell'Inbox (T5, T13, T15) | Met con riserve | Conforme (v3, v14); FLOW "bulk parziale" non implementabile (m9); redirect della home (M11). |
| CRM-S5 — Stati, touchpoint, messaggi manuali (T5, T16) | Met | Invarianti di stato verificati (v3, v14); rischio `SQLITE_BUSY` sulle azioni durante i job (M3). |
| CRM-S6 — Analisi AI: riassunto, angoli, fit (T11, T15, T16) | Met con riserve | Correttezza verificata (v7); ri-pagamento con `enrichFirst` (M5); analisi pagata persa su `SQLITE_BUSY` (M3); delimitatori del prompt falsificabili (m12). |
| CRM-S7 — Export verso l'email tool (T12, T15) | Met con riserve | Scope, colonne e sicurezza CSV verificati (v8, v10); ri-download con scartati/uniti (m10, m17). |
| CRM-S8 — Arricchimento on-demand (T6, T10, T15, T16) | **Unmet** | Il job fallisce per intero su un solo campo inatteso (B5); ri-pagamento dei profili senza dati (M5); guardia pid e retry (M4, B3). |
| Invariante "single-user, locale, niente auth" (PLAN §5, contract) | **Unmet** | API su tutte le interfacce (B1) e senza difesa cross-site (M1). |
| Invariante "preview/blocchi prima di ogni spesa, mai due volte lo stesso dato" (contract) | **Unmet** | B3, M5, M6, M7. |
| Invariante "un solo job alla volta" (contract, T6) | Met con riserve | Garantito nel caso normale; blocco permanente con pid riusato (M4). |
| Test ed e2e non toccano `data/` (AGENTS.md, T20) | **Unmet** | B2 (cancellazione del DB reale con variante di maiuscole). |
| FLOW Edge "reazione + dipendente: un prospect" | **Unmet** | M10. |
| FLOW Edge "DB vuoto ma profilo/ICP presenti → Inbox" | **Unmet** | M11. |
| FLOW Error path "Bulk: item fallisce → N riusciti · M errori" | **Unmet** | m9 (non implementabile con transazioni atomiche). |
| FLOW Error path "Processo figlio muore → Riprova" senza ri-pagare | **Unmet** | M7, m7. |

## Notes for docs-maintenance

- Durable findings to fold into `tech-debt/prospect-crm/crm-foundation.md`: tutti i **MINOR** (m1–m23) e i **NIT** che non
  verranno corretti nel round di remediation; BLOCKER e MAJOR vanno risolti prima dello ship (se qualcuno viene
  accettato esplicitamente, portarlo in tech-debt con la motivazione). Aggiornare **TD-1** (escalation M10: il merge
  dopo arricchimento non avviene con `ACwAA`) e **TD-17** (escalation B3: "Riprova" non è contenuto nei costi).
- Domain pages that should backlink this review: [[domains/prospect-crm/prospect-crm-contract]] (invarianti identità,
  locale/senza auth, anti-doppia-spesa, un solo job), [[domains/prospect-crm/prospect-crm]].
- Evidenze dei probe (non versionate, scratchpad della sessione): script e DB temporanei di ogni pass in
  `scratchpad/review/` (es. `v2/probe1-3.mts`, `pass-v11-dbguard/run-probe.sh`, `spend-v5/probe-*.mts`,
  `identity-v1/probe1.mts`, `v4-jobs-lifecycle/*`).
