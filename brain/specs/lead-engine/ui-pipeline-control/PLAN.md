---
domain: lead-engine
type: plan
links:
  - "[[specs/lead-engine/ui-pipeline-control/SPEC|SPEC]]"
created: 2026-06-12
updated: 2026-06-12
---

# Plan: Controllo pipeline dalla web UI — lancio run, stato ed erase dati

Spec di riferimento: [[specs/lead-engine/ui-pipeline-control/SPEC|SPEC.md]] (stessa cartella).

---

## Situazione iniziale

- Il run daily si lancia solo da CLI: `npm run cli pipeline -- --daily` → `runDaily()` in `src/pipeline/run.ts:148`. Funzione batch one-shot, ritorna `Promise<void>`, logga su `console.log`, nessun callback di progresso, nessun `process.exit`.
- Il server UI (`src/server/index.ts`) è Hono 4 + `@hono/node-server`, porta `UI_PORT ?? 8787`, avviato con `npm run api` (tsx). App e `serve()` vivono nello stesso modulo a livello di import (oggi non testabile in isolamento).
- DB: better-sqlite3 **sincrono**, connessione singleton creata all'import in `src/db/index.ts:80` (`config.paths.db`, default `data/sevedemo.db`), WAL attivo, schema idempotente inline. Tabelle: `contacts`, `runs`, `daily_selection`, `kv`, `outcomes`. Nessun helper di reset.
- Config letta all'import (`src/config.ts`): `DB_PATH` override possibile via env. Exports in `config.paths.exports` (= `exports/`), scritti da `exportContacts()` in `src/export/csv.ts`.
- Frontend `web/`: React 19, TanStack Router file-based (7 route in `web/src/routes/`), TanStack Query (staleTime 10s, no polling), Tailwind 4. Fetch wrapper in `web/src/api/client.ts`, shell/nav in `web/src/routes/__root.tsx`. Nessun componente toast/modal.
- Nessun framework di test nel repo. Script utili: `typecheck` (root), `ui:build` (web), `ui` (dev concorrente api+web).

## Problema

Un operatore non tecnico non può avviare il run daily, non vede se un run è in corso, non riceve l'esito, e non può azzerare i dati per ripetere i test. Tutti i criteri di accettazione sono nella SPEC; questo piano li implementa.

## Forma della soluzione

1. **Job manager lato server** (`src/server/jobs.ts` + wrapper `src/server/run-daily-job.ts`): avvia il run daily come **processo figlio** perché better-sqlite3 sincrono bloccherebbe l'event loop del server. Il figlio non è la CLI ma un wrapper dedicato (`node_modules/.bin/tsx src/server/run-daily-job.ts`, cwd = ROOT, env ereditato) che esegue `runDaily()` e **scrive lui stesso lo stato terminale** in `kv` (`succeeded`, oppure `failed` con `err.message` — già in linguaggio comprensibile per gli errori gestiti). Il server scrive il record `running` allo spawn e fa solo da fallback: se il figlio esce senza aver scritto lo stato terminale (crash duro), l'handler `exit` marca `failed` con il tail di stderr (~2000 char). Così un restart del server durante il run non perde l'esito reale. Stato in `kv` chiave `ui_job:daily`, JSON `{state, started_at, finished_at, pid, run_date, error}`: sopravvive a reload del browser e restart del server. Liveness check sul `pid` quando lo stato letto è `running` (pid morto e nessuno stato terminale scritto → `failed` "interrotto").
2. **Modulo erase** (`src/db/erase.ts`): `DELETE` transazionale su `outcomes`, `daily_selection`, `runs`, `kv`, `contacts` (ordine FK-safe) + cancellazione dei file regolari in `exports/` (cartella preservata, tollerare cartella assente). Ritorna i conteggi. Dipendenze iniettabili (`db`, `exportsDir`) con default, per testabilità.
3. **API**: `POST /api/pipeline/run` (202, 409 se running), `GET /api/pipeline/status` (stato effettivo, `idle` se chiave kv assente), `POST /api/data/erase` (body `{confirm:"ERASE"}`; 400 se confirm errato, 409 se running). Refactor minimo: estrarre `createApp()` in `src/server/app.ts` così gli endpoint sono testabili con `app.request()`; `src/server/index.ts` resta solo bootstrap `serve()`.
4. **Frontend**: client API esteso; hook `usePipelineStatus` con `refetchInterval` dinamico (2.5s se `running`, 15s altrimenti); badge di stato globale nella sidebar (`__root.tsx`) + toast su transizione `running → succeeded|failed` (link alla selezione del giorno in caso di successo); card "Pipeline" sulla dashboard (lancio con conferma costo ~2$, disabilitata se running, esito ultimo run); card "Zona pericolosa" sulla dashboard (erase con conferma digitata, bloccata se running, invalidazione totale delle query a successo).
5. **Test**: Vitest a root sui moduli nuovi (erase, job manager, endpoint) con DB temporaneo via `DB_PATH` impostata prima dell'import dei moduli (config letta a import-time) e/o iniezione di dipendenze. Comando finto (`node -e ...`) al posto della pipeline reale nei test del job manager.

## Decision ledger (risolto)

| # | Decisione | Razionale |
|---|-----------|-----------|
| D1 | Run come processo figlio del server (spawn della CLI esistente) | better-sqlite3 sincrono: in-process bloccherebbe l'event loop per minuti |
| D2 | UI osserva lo stato via polling TanStack Query | Run di minuti; SSE/WS sproporzionati per lo stack attuale |
| D3 | Erase = DELETE transazionale + svuotamento `exports/`, schema e file `.db` intatti | Evita di chiudere/riaprire la connessione singleton; conserva lo schema |
| D4 | Stato job in `kv` scritto dal server; run CLI invisibili in UI | Un solo canale di lancio in fase test (chiude OQ#1 della spec); zero modifiche alla pipeline |
| D5 | Vitest, coverage solo moduli nuovi | Repo senza framework; retrofit fuori scope |
| D6 | Nessun backlog esterno: brain è la fonte di verità | Nessun tracker in uso nel repo |
| D7 | Controlli UI sulla dashboard (`index.tsx`), nessuna nuova route | Evita rigenerazione routeTree; la dashboard è la landing dell'operatore |

## Assunzioni e vincoli

- Un solo canale di lancio (UI) in fase di test; un run CLI parallelo non è rilevato (assunzione esplicita da SPEC OQ#1). **Conseguenza accettata:** anche la guardia 409 dell'erase non vede un run lanciato da CLI; un erase durante un run CLI interlaccerebbe delete e scritture pipeline.
- Fase di test: il deploy "production build" del server non è in scope; lo spawn usa `tsx` (dev runtime già in uso).
- OQ#2 della spec (erase oltre la fase di test) non blocca: l'azione resta visibile, protetta da conferma digitata.
- Erase cancella anche la chiave `ui_job:daily` (è in `kv`): accettato, dopo l'erase lo stato torna `idle` e l'esito storico sparisce — coerente con "stato vuoto".
- `process.kill(pid, 0)` come liveness check è affidabile su darwin/linux (ambiente target); il falso positivo da pid riciclato è accettato su una macchina di sviluppo (e mitigato dal fatto che il wrapper scrive lo stato terminale da sé).

## Findings dal codebase (ancore per i task)

- `runDaily()`: `src/pipeline/run.ts:148` — già esegue export e `logRun` per strategia; il successo del job è dato dall'exit code della CLI, non serve parsing dell'output.
- CLI: `src/cli.ts:40-60` — `pipeline --daily` setta `process.exitCode = 1` su errore con messaggio su stderr/console.
- DB singleton + schema: `src/db/index.ts:80-82`; kv helpers esistenti in `src/db/kv.ts`.
- Server: `src/server/index.ts:25-26` (app), `:162` (`app.route('/api', api)`), `:184-190` (`serve()`); pattern error JSON `{error}` con status appropriato già in uso.
- Config import-time: `src/config.ts:14-37`; `config.paths.exports` esiste già.
- Frontend: wrapper `request<T>` in `web/src/api/client.ts:14`; QueryClient in `web/src/main.tsx:8-12`; shell in `web/src/routes/__root.tsx:23-55` (sidebar fissa — punto di mount per badge globale); dashboard `web/src/routes/index.tsx`. **Attenzione:** con `stats.total === 0` la dashboard renderizza solo l'EmptyState (`index.tsx:29`), che oggi suggerisce il comando CLI — esattamente lo stato post-erase/primo uso.
- Script web: `build` è solo `vite build` (NON typechecka); `typecheck` è uno script separato. I gate devono lanciarli entrambi.
- Root tsconfig: `include: ["src"]` + `rootDir: "src"` → una cartella `tests/` non verrebbe typecheckata da `npm run typecheck` senza un tsconfig dedicato.
- Nessun toast/modal esistente in `web/src/components/ui.tsx` → da aggiungere primitive minime.

## Ricerca esterna

- Nessuna libreria nuova oltre Vitest. Hono `app.request()` per i test degli endpoint (API nativa Hono, nessun supertest necessario). TanStack Query supporta `refetchInterval` come funzione del query state (già nella versione in uso).

## Dependency graph e onde di esecuzione

```
T1 (vitest setup)
├── T2 (erase module)      ┐
└── T3 (job manager)       ├── T4 (API endpoints + createApp refactor)
                           │        └── T5 (client API + hook polling)
                           │                 └── T6 (shell: badge + toast)
                           │                          └── T7 (dashboard: card pipeline)
                           │                                   └── T8 (dashboard: danger zone)
                           └──────────────────────────────────────────└── T9 (gate finale)
```

- **Wave 1:** T1
- **Wave 2:** T2 ∥ T3
- **Wave 3:** T4
- **Wave 4:** T5
- **Wave 5:** T6
- **Wave 6:** T7 poi T8 (sequenziali: entrambi modificano `web/src/routes/index.tsx`)
- **Wave 7:** T9

## Strategia di test

- Vitest a root (`npm test`), ambiente node. **Isolamento DB obbligatorio:** un `tests/setup.ts` registrato in `setupFiles` assegna `process.env.DB_PATH` a un percorso temporaneo unico (`fs.mkdtempSync` + suffisso per processo) prima che qualunque modulo carichi; i moduli che toccano il singleton (`src/db/index.ts` e derivati) vanno importati nei test con `await import()` dinamico, mai con import statico hoisted. Motivo: gli import ESM statici sono hoisted sopra qualunque assegnazione env nel file di test, e il default di `eraseAllData()` punta al singleton → un errore qui **trunca il DB di sviluppo reale**.
- Job manager testato con comando finto (es. `node -e "process.exit(0)"` / `process.exit(1)` / sleep) — mai la pipeline reale.
- Endpoint testati con `app.request()` su `createApp()` e DB temporaneo, con comando finto iniettato per il job.
- Frontend validato via browser (`$agent-browser`): nessun test unit React in questa fase (D5).

## Rischi e mitigazioni

| Rischio | Mitigazione |
|---------|-------------|
| `SQLITE_BUSY` tra server e processo figlio che scrivono lo stesso DB | `db.pragma('busy_timeout = 5000')` in `src/db/index.ts` (vale per entrambi i processi) — incluso in T3 |
| Restart del server durante un run | Il wrapper figlio scrive da sé lo stato terminale in `kv`: il server riavviato legge l'esito reale. Pid liveness solo come fallback per crash duri del figlio |
| API key mancanti (`APIFY_TOKEN`, `ANTHROPIC_API_KEY`) | Il wrapper fallisce subito e scrive `failed` con `err.message` (già comprensibile, es. "APIFY_TOKEN mancante…") |
| Doppio submit dal client | Bottone disabilitato su `running` + guardia server-side 409 (fonte di verità) |
| React StrictMode → doppio effetto → toast duplicato | Rilevazione transizione confrontando lo stato precedente del query cache, logica idempotente |
| `exports/` assente al momento dell'erase | `fs.existsSync` / tolleranza ENOENT, la cartella non è ricreata |
| Spawn `tsx` non disponibile in un eventuale deploy buildato | Fuori scope (fase test); registrato come debito: il comando di spawn è centralizzato in `jobs.ts` |

## Gate di validazione per fase

- **Fine Wave 3 (backend):** `npm test` verde (erase, jobs, endpoint), `npm run typecheck` verde (inclusi i test via tsconfig dedicato). Il check 202/409 vive **nei test** `app.request()` con comando finto iniettato — **mai** uno smoke `curl` contro il server con `.env` reale: lancerebbe una pipeline vera (~2 $) sul DB di sviluppo. Eventuale smoke manuale solo con override del comando job e `DB_PATH` scratch.
- **Fine Wave 6 (frontend):** `npm --prefix web run typecheck && npm --prefix web run build` verdi; pass browser con `$agent-browser` su: lancio con conferma, badge running su tutte le pagine, sopravvivenza a reload, toast di esito, erase con conferma digitata e dashboard vuota.
- **Wave 7 (T9):** checklist completa dei criteri di accettazione della SPEC, uno per uno.

## Domande irrisolte

- SPEC OQ#2: l'erase resterà in produzione? Non blocca il piano; default = visibile con conferma digitata. Decidere prima del go-live reale.

## Backlog sync

Decisione D6: nessun tracker esterno. I task referenziano la spec nel brain come "story" proprietaria. `relation_mode: body-links` per tutti.

---

## Tasks

### T1: Setup Vitest a root

- **depends_on**: []
- **location**: `package.json`, `vitest.config.ts`, `tsconfig.tests.json`, `tests/setup.ts`, `tests/smoke.test.ts`
- **description**: Aggiungere `vitest` come devDependency root, script `"test": "vitest run"` (+ `"test:watch"`), config ambiente node con include `tests/**/*.test.ts` e `setupFiles: ['tests/setup.ts']`. `tests/setup.ts` assegna `process.env.DB_PATH` a un percorso temporaneo **unico** (`fs.mkdtempSync` + suffisso per processo) prima di ogni file di test. `tsconfig.tests.json` (extends root, include `tests`, senza `rootDir`/`outDir`) agganciato allo script `typecheck` (`tsc --noEmit && tsc -p tsconfig.tests.json --noEmit`), perché il root tsconfig include solo `src/`. Test smoke: dynamic `await import('src/db/index.ts')` e verifica che il file DB creato sia quello temporaneo, non `data/sevedemo.db`.
- **validation**: `npm test` esce 0 con il test smoke verde; `npm run typecheck` (esteso) typechecka anche `tests/`; il DB reale `data/sevedemo.db` non viene toccato dai test (mtime invariato).
- **status**: Done
- **log**: RED verificato (DB_PATH undefined, fallimento prima dell'import del DB) → GREEN con `tests/setup.ts` (mkdtempSync + pid). `npm test` e `npm run typecheck` verdi; mtime di `data/sevedemo.db` invariato prima/dopo.
- **files edited/created**: `package.json` (vitest dep + scripts test/test:watch/typecheck), `vitest.config.ts`, `tsconfig.tests.json`, `tests/setup.ts`, `tests/smoke.test.ts`
- **backlog_item_id**: brain:lead-engine/ui-pipeline-control
- **backlog_item_url**: brain/specs/lead-engine/ui-pipeline-control/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: `npm test` esegue e fallisce/passa in modo deterministico su un primo test pubblico (smoke su import config con env override).
- **review_mode**: cli

### T2: Modulo erase dati

- **depends_on**: [T1]
- **location**: `src/db/erase.ts`, `tests/erase.test.ts`
- **description**: `eraseAllData(deps?)` con default `{ database: db, exportsDir: config.paths.exports }`. Transazione che svuota `outcomes`, `daily_selection`, `runs`, `kv`, `contacts` (ordine FK-safe) e azzera `sqlite_sequence` (tollerando l'assenza della tabella) così gli id AUTOINCREMENT ripartono da 1; poi cancella i file regolari in `exportsDir` (tollera dir assente, non tocca sottocartelle/seeds). Ritorna `{contacts, runs, selections, outcomes, kv, exportFiles}`.
- **validation**: Test integrazione: DB temporaneo seminato su tutte e 5 le tabelle + file fittizi in una exports dir temporanea → dopo `eraseAllData` tutte le tabelle hanno 0 righe, i file export non esistono più, i conteggi tornano corretti; seconda invocazione su stato vuoto non lancia.
- **status**: Done
- **log**: RED (modulo assente) → GREEN. 3 test: erase completo con conteggi, restart AUTOINCREMENT + sottocartelle exports preservate, doppia invocazione innocua con dir assente. `npm test` (4 totali) e typecheck verdi.
- **files edited/created**: `src/db/erase.ts`, `tests/erase.test.ts`
- **backlog_item_id**: brain:lead-engine/ui-pipeline-control
- **backlog_item_url**: brain/specs/lead-engine/ui-pipeline-control/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: Primo test rosso: "DB seminato + exports fittizi → eraseAllData() lascia le 5 tabelle vuote e la dir exports senza file, ritornando i conteggi".
- **review_mode**: cli

### T3: Job manager run daily (processo figlio + stato in kv)

- **depends_on**: [T1]
- **location**: `src/server/jobs.ts`, `src/server/run-daily-job.ts` (nuovo wrapper), `src/db/index.ts` (pragma), `tests/jobs.test.ts`
- **description**: Modulo `jobs.ts` con `startDailyRun(opts?)`, `getJobStatus()`. Stato persistito in `kv` chiave `ui_job:daily` (JSON `{state, started_at, finished_at, pid, run_date, error}`). `startDailyRun()` rifiuta se lo stato effettivo è `running` (errore tipizzato → 409 in T4); scrive il record `running` e spawna il **wrapper** `node_modules/.bin/tsx src/server/run-daily-job.ts` (cwd ROOT, env ereditato); command/args iniettabili via `opts` per test e smoke. Il wrapper esegue `runDaily()` e scrive **lui stesso** lo stato terminale in `kv`: `succeeded`, oppure `failed` con `err.message` (comprensibile per gli errori gestiti) — così l'esito sopravvive a un restart del server. L'handler `exit` del server è solo fallback: child uscito senza stato terminale → `failed` con tail stderr (~2000 char). `getJobStatus()`: chiave assente → `idle`; `running` con pid morto (`process.kill(pid,0)` lancia) → riscrive `failed` "Run interrotto (processo non più attivo)". Aggiungere `db.pragma('busy_timeout = 5000')` in `src/db/index.ts` accanto al pragma WAL.
- **validation**: Test con comandi finti: successo → stato passa per `running` e termina `succeeded`; fallimento → `failed` con messaggio; doppio start mentre `running` → errore conflitto; pid morto con stato `running` e nessuno stato terminale → `getJobStatus()` ritorna `failed` interrotto; stato terminale scritto dal child vince sull'handler del server (nessuna sovrascrittura).
- **status**: Done
- **log**: 3 cicli RED→GREEN: (1) tracer successo + doppio start (figlio finto che scrive `succeeded` in kv come il wrapper); (2) crash senza stato terminale → fallback failed con stderr tail; (3) running orfano con pid morto → failed "interrotto" persistito. Wrapper `run-daily-job.ts` scritto (non testato unit: esegue la pipeline reale, logica kv minima identica al fake). Pragma `busy_timeout=5000` aggiunto. Race figlio-istantaneo gestita: record running scritto prima dello spawn, pid aggiunto solo se lo stato è ancora running.
- **files edited/created**: `src/server/jobs.ts`, `src/server/run-daily-job.ts`, `src/db/index.ts` (pragma), `tests/jobs.test.ts`
- **backlog_item_id**: brain:lead-engine/ui-pipeline-control
- **backlog_item_url**: brain/specs/lead-engine/ui-pipeline-control/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: Primo test rosso: "startDailyRun() con comando finto a successo porta lo stato da running a succeeded; un secondo startDailyRun() durante running solleva conflitto".
- **review_mode**: cli

### T4: Endpoint API + refactor createApp

- **depends_on**: [T2, T3]
- **location**: `src/server/app.ts` (nuovo), `src/server/index.ts`, `tests/api.test.ts`
- **description**: Estrarre la costruzione dell'app Hono in `createApp(opts?)` (`src/server/app.ts`) senza cambi di comportamento; `opts` permette di iniettare la config del job manager (comando finto nei test; default = job reale), `index.ts` resta bootstrap (`serve()`, static, porta) e usa i default. Nuovi endpoint: `POST /api/pipeline/run` → 202 + status (409 `{error}` se running); `GET /api/pipeline/status` → status effettivo; `POST /api/data/erase` → valida body `{confirm:"ERASE"}` (400 altrimenti), 409 se running, 200 + conteggi. Stile errori `{error}` coerente con gli endpoint esistenti.
- **validation**: Test `app.request()` su DB temporaneo: status iniziale `idle`; POST run (comando finto iniettato) → 202 e status `running`; secondo POST → 409; erase durante running → 409; erase con confirm errato → 400; erase a riposo → 200, tabelle vuote. Endpoint esistenti invariati (smoke su `/api/health`, `/api/stats`). `npm run typecheck` verde.
- **status**: Done
- **log**: RED (modulo app assente) → GREEN con estrazione `createApp(opts)` 1:1 da index.ts + 3 endpoint nuovi; index.ts ridotto a bootstrap (serve, static, porta). **Deviazione safety:** `opts.erase` (EraseDeps) aggiunto oltre a `opts.job`, altrimenti i test dell'erase avrebbero cancellato la cartella `exports/` reale. Verificato anche: erase azzera lo stato job (kv) → status torna `idle`. Gate Wave 3: 10 test + typecheck verdi, nessuno smoke curl su server reale.
- **files edited/created**: `src/server/app.ts` (nuovo), `src/server/index.ts` (riscritto come bootstrap), `tests/api.test.ts`
- **backlog_item_id**: brain:lead-engine/ui-pipeline-control
- **backlog_item_url**: brain/specs/lead-engine/ui-pipeline-control/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: Primo test rosso: "POST /api/pipeline/run → 202 e GET /api/pipeline/status → running; secondo POST → 409".
- **review_mode**: cli

### T5: Client API frontend + hook di polling

- **depends_on**: [T4]
- **location**: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/lib/pipeline.ts` (nuovo)
- **description**: Tipi `PipelineStatus` (`state: 'idle'|'running'|'succeeded'|'failed'`, timestamps, `run_date`, `error`) ed `EraseResult`; metodi `api.pipelineStatus()`, `api.startPipeline()`, `api.eraseData()` (POST con `{confirm:'ERASE'}`). Hook `usePipelineStatus()`: `useQuery` chiave `['pipeline-status']`, `refetchInterval` funzione → 2500ms se `running`, 15000ms altrimenti, `staleTime: 0`. Hook `useStartPipeline()` e `useEraseData()` come mutation con invalidazione di `['pipeline-status']` (e invalidazione totale del query cache per l'erase).
- **validation**: `npm --prefix web run typecheck && npm --prefix web run build` verdi (il build da solo NON typechecka); in dev, con server attivo, la console di rete mostra il polling a 15s e il passaggio a 2.5s durante un run finto (avviato con comando job override e `DB_PATH` scratch, mai pipeline reale).
- **status**: Done
- **log**: Typecheck+build verdi. Polling verificato dai log del server di smoke (`scripts/ui-smoke-server.ts`, creato come tooling: DB+exports scratch, job finto configurabile): richieste a 2.5s esatti durante il run, 15s a riposo. Nota di design osservata: un run più corto della finestra di polling idle (15s) può non essere mai osservato come `running` → nessun toast; irrilevante coi run reali (minuti).
- **files edited/created**: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/lib/pipeline.ts` (nuovo), `scripts/ui-smoke-server.ts` (tooling di validazione, nuovo)
- **backlog_item_id**: brain:lead-engine/ui-pipeline-control
- **backlog_item_url**: brain/specs/lead-engine/ui-pipeline-control/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: Comportamento pubblico osservabile: l'hook espone lo stato del server e accelera il polling quando `running` (verifica via network panel con run avviato da curl).
- **review_mode**: mixed
- **assigned_skills**: [agent-browser]

### T6: Shell globale — badge di stato + notifiche toast

- **depends_on**: [T5]
- **location**: `web/src/components/ui.tsx`, `web/src/routes/__root.tsx`
- **description**: Primitive `Toast`/`ToastHost` minime in `ui.tsx` (success/error, auto-dismiss, dismiss manuale). Nel layout root: montare `usePipelineStatus()`; badge "Run in corso…" (con spinner e minuti trascorsi) visibile nella sidebar su **tutte** le pagine quando `running`; rilevazione transizione `running → succeeded` → toast con link a `/selections/$date` (run_date), `running → failed` → toast errore con il messaggio del campo `error` (il wrapper scrive `err.message`, già comprensibile; eventuale tail stderr grezzo solo come dettaglio espandibile); idempotente rispetto a remount/StrictMode (confronto con stato precedente, nessun doppio toast). A pagina ricaricata con run attivo il badge riappare (stato dal server).
- **validation**: Browser: avviato un run (anche via curl), il badge compare su Dashboard/Contatti/Run; reload → badge ancora presente; a fine run toast di esito visibile anche stando su un'altra pagina; il link del toast porta alla selezione del giorno.
- **status**: Done
- **log**: Pass browser con agent-browser su smoke server: badge "Run in corso · Xm" su /, /contacts, /runs; sopravvive al reload; toast successo ricevuto stando su /runs con link cliccato → /selections/2026-06-12; toast errore con messaggio piano ("Errore simulato: APIFY_TOKEN mancante…"); nessun doppio toast con StrictMode attivo. Toast: auto-dismiss 8s (successo) / 20s (errore), errori lunghi (>180 char) collassati in `<details>`. pushToast con store pub/sub a livello modulo così anche le pagine (T8) possono notificare.
- **files edited/created**: `web/src/components/ui.tsx` (Toast/ToastHost/pushToast), `web/src/routes/__root.tsx` (badge + transizioni)
- **backlog_item_id**: brain:lead-engine/ui-pipeline-control
- **backlog_item_url**: brain/specs/lead-engine/ui-pipeline-control/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: Primo comportamento osservabile: con status `running` dal server, il badge è visibile su ogni route e sopravvive al reload.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T7: Dashboard — card lancio pipeline ed esito ultimo run

- **depends_on**: [T6]
- **location**: `web/src/routes/index.tsx`, `web/src/components/ui.tsx` (modal di conferma se non già presente)
- **description**: Card "Pipeline" in cima alla dashboard, renderizzata **incondizionatamente, sopra il branch `s.total === 0`** (`index.tsx:29`): l'operatore deve poter lanciare il primo run proprio a DB vuoto (stato post-erase/primo uso). Mostra stato corrente (idle/running/esito ultimo run con orari e, su `failed`, il messaggio d'errore in linguaggio piano); bottone "Avvia run daily" → modal di conferma con avviso costo (~2 $ Apify + chiamate LLM) → `useStartPipeline()`; bottone disabilitato durante `running` e durante la mutation (no doppio submit); su 409 dal server mostra il motivo. Link alla selezione del giorno quando l'ultimo run è `succeeded`. Aggiornare il testo dell'EmptyState: non suggerire più `npm run pipeline -- --daily`, puntare al bottone della card.
- **validation**: Browser: click avvia → modal → conferma → badge running, bottone disabilitato con motivazione; doppio click non genera secondo run (409 gestito); a run finito la card mostra l'esito e il link alla selezione.
- **status**: Done
- **log**: Pass browser su smoke server: card mostra l'esito failed persistito (con messaggio piano) al ritorno; click → modal "~2 $ di credito Apify" → conferma → stato running in card + badge, bottone `disabled:true` (verificato via eval JS; doppio submit impossibile, guardia 409 server-side già coperta dai test API) con motivazione visibile; a fine run "Ultimo run completato" + link "Apri la selezione del giorno →". EmptyState aggiornato (bottone invece del comando CLI). Card visibile a DB vuoto: confermata nel pass di T8 post-erase.
- **files edited/created**: `web/src/routes/index.tsx` (PipelineCard + EmptyState), `web/src/components/ui.tsx` (Modal)
- **backlog_item_id**: brain:lead-engine/ui-pipeline-control
- **backlog_item_url**: brain/specs/lead-engine/ui-pipeline-control/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: Primo comportamento osservabile: avvio dalla UI con conferma → status `running` senza uso del terminale; secondo tentativo bloccato con motivazione visibile.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T8: Dashboard — zona pericolosa (erase completo)

- **depends_on**: [T7]
- **location**: `web/src/routes/index.tsx`
- **description**: Card "Zona pericolosa" in fondo alla dashboard, visibile anche a DB vuoto (erase su vuoto è un no-op innocuo): descrizione di cosa viene cancellato (contatti, selezioni, storico run, outcomes, cursori query, file export — seeds esclusi) e che l'azione è irreversibile; bottone rosso → modal con conferma digitata (l'utente scrive `ERASE`); disabilitata durante `running` con motivazione. A successo: toast con conteggi, invalidazione totale del query cache → dashboard a zero.
- **validation**: Browser: con dati presenti, erase → conferma digitata → dashboard mostra 0 contatti / nessuna selezione / nessun run senza reload manuale; con run in corso il bottone è disabilitato; conferma digitata errata non abilita l'esecuzione.
- **status**: Done
- **log**: Pass browser su smoke server (28 contatti demo + 1 file export fittizio): "Cancella tutto" disabilitato senza testo e con testo errato ("ERASA"); con "ERASE" → toast "Dati azzerati — Cancellati 28 contatti, 9 run, 28 selezioni, 12 outcomes e 1 file export", dashboard a vuoto senza reload (invalidateQueries), card Pipeline e Zona pericolosa ancora visibili a DB vuoto, exports svuotata su filesystem; con run in corso bottone `disabled:true` + "Disabilitato: un run è in corso.". Stato pipeline post-erase → idle (kv azzerata, come da assunzione del piano).
- **files edited/created**: `web/src/routes/index.tsx` (DangerZoneCard), `web/src/components/ui.tsx` (btn.dangerSolid)
- **backlog_item_id**: brain:lead-engine/ui-pipeline-control
- **backlog_item_url**: brain/specs/lead-engine/ui-pipeline-control/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: Primo comportamento osservabile: erase confermato → dashboard riflette lo stato vuoto senza reload; erase rifiutato se un run è in corso.
- **review_mode**: browser
- **assigned_skills**: [agent-browser]

### T9: Gate finale — criteri di accettazione SPEC

- **depends_on**: [T2, T3, T4, T5, T6, T7, T8]
- **location**: repo (nessun file nuovo previsto; fix puntuali se il gate fallisce)
- **description**: Verifica completa: `npm test`, `npm run typecheck` (incluso tsconfig test), `npm --prefix web run typecheck`, `npm --prefix web run build` verdi. Pass browser sull'intera checklist dei criteri di accettazione della SPEC (avvio, run in corso cross-pagina e cross-reload, notifica esito successo/errore, erase completo con stato vuoto e seeds intatti — verificare su filesystem che `data/seeds/` sia invariata e `exports/` svuotata). Verifica che il flusso CLI esistente (`npm run cli pipeline -- --daily`) resti invocabile (smoke: `npm run cli strategies`).
- **validation**: Tutti i comandi verdi + checklist SPEC spuntata voce per voce nel log del task.
- **status**: Done
- **log**: Comandi: `npm test` 10/10, `npm run typecheck` (root+tests), `npm --prefix web run typecheck`, `npm --prefix web run build`, `npm run cli strategies` tutti verdi. DB reale intatto dai test (mtime invariato prima/dopo `npm test`; il solo `cli strategies` lo apre, comportamento pre-esistente). Checklist SPEC: (1) avvio da UI con conferma ✓; (2) secondo avvio bloccato con motivazione + 409 ✓; (3) doppio submit impossibile (disabled + guardia server) ✓; (4) badge su ogni pagina ✓; (5) stato sopravvive a reload (kv) ✓; (6) run prosegue senza browser (processo figlio; run via curl completano) ✓; (7) toast successo con link a /selections/$date ✓; (8) toast errore comprensibile ✓; (9) esito su altra pagina e al ritorno (card dashboard persistita) ✓; (10) erase azzera 5 tabelle + exports ✓; (11) data/seeds intatta ✓; (12) conferma digitata ERASE + "irreversibile" ✓; (13) erase bloccato durante run (UI + 409) ✓; (14) dashboard a zero senza reload, id da 1, cursori kv azzerati ✓. Pass `$simplify` applicato prima del gate (writeTerminalStatus condiviso, terza lettura kv evitata, JOB_KV_KEY interpolato nello smoke, Spinner estratto).
- **files edited/created**: `src/server/jobs.ts`, `src/server/run-daily-job.ts`, `scripts/ui-smoke-server.ts`, `web/src/components/ui.tsx`, `web/src/routes/__root.tsx`, `web/src/routes/index.tsx` (refactor $simplify)
- **backlog_item_id**: brain:lead-engine/ui-pipeline-control
- **backlog_item_url**: brain/specs/lead-engine/ui-pipeline-control/SPEC.md
- **relation_mode**: body-links
- **tdd_target**: n/a (gate di regressione: i test esistenti e la checklist SPEC fungono da rete).
- **review_mode**: mixed
- **assigned_skills**: [agent-browser]
