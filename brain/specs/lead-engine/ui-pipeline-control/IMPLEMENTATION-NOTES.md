---
domain: lead-engine
type: implementation-notes
spec: ui-pipeline-control
links:
  - "[[specs/lead-engine/ui-pipeline-control/SPEC]]"
ingested: false
last_ingested: null
created: 2026-06-12
updated: 2026-06-12
---

# Implementation Notes

## Summary

- Eseguito l'intero PLAN.md (T1–T9): run daily avviabile dalla web UI come processo figlio del server con stato persistito in `kv` (`ui_job:daily`), badge globale + toast di esito via polling TanStack Query (2.5s in run / 15s a riposo), erase completo transazionale con conferma digitata. 10 test Vitest (isolamento DB via `DB_PATH` temporanea), validazione browser con agent-browser su un server di smoke con job finto — la pipeline reale (~2 $/run) non è mai stata eseguita.

## Execution Mode

- `sequential` — un task alla volta in ordine di dipendenza (T1 → … → T9), TDD RED→GREEN sui moduli backend, pass `$simplify` prima del gate finale. Nessun worker. Advisor di progetto: nessuno definito → pass saltati.

## Deviations From the Plan

- `createApp(opts)` accetta anche `erase?: EraseDeps` oltre a `job` (il piano prevedeva solo il job): senza, i test dell'endpoint erase avrebbero cancellato la cartella `exports/` reale.
- Creato `scripts/ui-smoke-server.ts` (non previsto come file dal piano, previsto come meccanica): server con DB/exports scratch e job finto configurabile (`FAKE_JOB_SECONDS`, `FAKE_JOB_OUTCOME`), usato per tutte le validazioni browser. Logga le richieste a `/api/pipeline/status` per verificare la cadenza di polling.
- Dopo `$simplify`: lo stato terminale del wrapper passa per `writeTerminalStatus()` esportato da `jobs.ts` (il piano lo duplicava nel wrapper); estratto componente `Spinner` condiviso.

## Surprises and Decisions

- Vitest `setupFiles` gira prima del caricamento di ogni file di test, quindi l'assegnazione di `DB_PATH` lì è sufficiente; gli import dinamici nei test restano come difesa in profondità (convenzione dal piano).
- Race figlio-istantaneo in `startDailyRun`: il record `running` è scritto prima dello spawn e il `pid` aggiunto solo se lo stato è ancora `running`, così un figlio velocissimo (nei test) non viene sovrascritto.
- Un run più corto della finestra di polling idle (15s) non viene mai osservato come `running` → nessun toast (esito comunque in card). Registrato in tech-debt come nota di design.
- `agent-browser is enabled` con selettore testuale si è rivelato inaffidabile: i check sui `disabled` sono stati fatti via `eval` JS.
- `npm run cli strategies` apre il DB reale all'import (comportamento pre-esistente della CLI): l'mtime cambia, ma `npm test` da solo lascia il DB intatto (verificato prima/dopo).

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| `npm test` | ✅ 10/10 | smoke isolamento, erase (3), jobs (3), api (3) |
| `npm run typecheck` | ✅ | root + `tsconfig.tests.json` |
| `npm --prefix web run typecheck` | ✅ | |
| `npm --prefix web run build` | ✅ | |
| `npm run cli strategies` | ✅ | flusso CLI esistente invariato |
| DB reale intatto dai test | ✅ | mtime `data/sevedemo.db` invariato prima/dopo `npm test` |
| `data/seeds/` intatta | ✅ | 4 file seed presenti, mai toccati dall'erase |
| Pass browser (agent-browser) | ✅ | su smoke server, dettagli nei log dei task T6–T8 |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| Avvio run da UI senza terminale | met | card Pipeline → modal con avviso ~2 $ → conferma |
| No secondo run con run in corso | met | bottone disabled con motivazione + 409 server (fonte di verità) |
| Doppio click non produce due run | met | disabled durante running/mutation + guardia 409 |
| Stato "run in corso" visibile da ogni pagina | met | badge in sidebar (layout root), verificato su /, /contacts, /runs |
| Stato sopravvive a reload/riapertura | met | stato in kv lato server, polling al mount |
| Run prosegue a browser chiuso | met | processo figlio del server; run avviati via curl completano da soli |
| Notifica successo con accesso al risultato | met | toast con link a `/selections/$date` (cliccato e verificato) |
| Notifica errore comprensibile | met | toast con `err.message` del wrapper; errori lunghi collassati in `<details>` |
| Notifica cross-pagina / esito visibile al ritorno | met | toast ricevuto su /runs; ultimo esito persistito nella card dashboard |
| Erase azzera tutte le tabelle + exports | met | DELETE transazionale 5 tabelle + `sqlite_sequence` + file in exports |
| Seed non toccati | met | l'erase tocca solo i file regolari di `exportsDir` |
| Conferma esplicita + irreversibilità segnalata | met | conferma digitata `ERASE`, testo "irreversibile" in card e modal |
| Erase non eseguibile durante un run | met | bottone disabled + 409 server |
| Post-erase: dashboard vuota, ripartenza da zero | met | invalidazione totale query (no reload), kv azzerata → cursori da capo, id da 1 |

## Pre-existing Issues

- La CLI apre (e quindi tocca) il DB reale a ogni invocazione, anche per comandi read-only come `strategies` — pre-esistente, fuori scope.

## Out of Scope Observations

- `web/src/components/ui.tsx` ha un componente `Avatar` che duplica `initials()` di `lib/format.ts` (pre-esistente, segnalato dal pass di review ma fuori dal diff).

## Remaining Work

- SPEC OQ#2 (l'erase resta visibile oltre la fase di test?) è una decisione di prodotto ancora aperta: default attuale = visibile con conferma digitata.
- Voci durevoli in `tech-debt/lead-engine/ui-pipeline-control.md` (spawn via tsx in deploy buildato, run CLI invisibili alla guardia, blind spot polling per run brevissimi).

## Post-implementation Fixes (2026-06-12, primo run reale)

Il primo run daily lanciato dalla UI ha estratto 134 profili reali ma li ha persi tutti a valle: 120 scartati con fit 0, 14 rimasti `new`. La selezione del giorno ha quindi ripiegato sugli unici due contatti demo rimasti in status `scored` (gli altri demo erano `selected`/`exported` dalle selezioni finte del seed) — sintomo visto in UI come "solo 2 freelance a punteggio basso, azienda vuoto". Due bug di mapping, fixati direttamente su richiesta di Omar (niente spec):

- **`normalizeLinkedinUrl` abbassava di caso lo slug** (`src/util/fields.ts`): harvestapi restituisce URL member-ID case-sensitive (`/in/ACwAA…`); lowercased diventavano irrisolvibili e l'enrichment (dev_fusion) rispondeva "No person found" per ogni profilo → scoring senza dati → tutto `scarta`. Fix: case dello slug preservato, restano normalizzati host/query/trailing slash. Il fix è nel normalizzatore condiviso, quindi vale per tutte le strategie e per il match dei risultati di enrichment.
- **`mapProfileItem` non leggeva i campi harvestapi** (`src/strategies/people-search.ts`): il payload ha `firstName`/`lastName` e `currentPositions[0].title/companyName`, non `fullName`/`headline` → contatti salvati senza nome né headline (e il pre-filtro keyword sull'headline diventava cieco). Fix: nome composto da firstName+lastName, headline ricostruita come `<title> @ <company>`; i campi top-level restano preferiti quando presenti.

Test: `tests/extraction-mapping.test.ts` (5 test, TDD RED→GREEN). Suite 15/15, typecheck pulito.

Caveat risolto: il run reale successivo (12/06, post-erase, lanciato da CLI per leggere i log) ha confermato i fix end-to-end — dev_fusion risolve i permalink member-ID a case preservato (120/120 enriched), scoring 120/120 con bucket e nomi reali, selezione 20+20 ed export completati. Restano da indagare (pre-esistenti, fuori da questa spec): `freelance-post-reactors` rende 0 item e `cost_estimate` resta 0.0 sui run reali.

## Steering

| Date | Feedback | Changes |
|------|----------|---------|
| 2026-06-12 | Diagnosi post-primo-run: selezione piena di contatti demo, estrazione reale tutta scartata. "Vai diretto con i fix, niente spec ma aggiungi a implementation notes" | Fix dei due bug di mapping (vedi sezione Post-implementation Fixes), 5 test nuovi |
