---
domain: prospect-crm
type: implementation-notes
spec: people-first-crm
links:
  - "[[specs/prospect-crm/people-first-crm/SPEC]]"
  - "[[specs/prospect-crm/people-first-crm/PLAN]]"
  - "[[specs/prospect-crm/people-first-crm/FLOW]]"
ingested: false
last_ingested: null
created: 2026-09-18
updated: 2026-09-19
---

# Implementation Notes — people-first-crm

## Summary

- **M1 (Persone e contatti manuali, T0–T16) completata il 2026-09-18**, in attesa del via dell'utente per M2. Smoke
  di tappa (`tests/e2e/smoke-people.md`, agente separato con sessione agent-browser propria): 0 BLOCKER, 2 MAJOR, 18
  MINOR; corretti i 2 MAJOR e 16 MINOR del tutto o in parte, restano 3 MINOR (sotto, Remaining Work).
- **M2 (Seguire le persone, T17–T27) completata il 2026-09-19**, in attesa del via dell'utente per M3: "Riprova…" con
  preview (chiude TD-25), fit manuale e fit effettivo, ricerca globale ⌘K (perf verificata su 10.000/2.000), Fatto /
  Rimanda / touchpoint con prossima azione, Oggi come home (chiude TD-38). Smoke di tappa (agente separato, sessione
  `smoke-m2`): **0 BLOCKER, 0 MAJOR, 6 MINOR**, tutti corretti e ricontrollati nel browser; poi un passaggio
  `simplify` sul diff di M2.

- **M3 (Connessioni, T28–T36) completata il 2026-09-20**, fine della spec: log di ogni run nel database locale
  (troncato al centro oltre le 5.000 righe, senza chiavi), strumenti di un run e attribuzione onesta dei
  fallimenti, Impostazioni in tre sezioni con **Connessioni**, pagina dei run per strumento e dettaglio con log in
  diretta e "Riprova…", avvisi in Oggi e "Dettagli del run" da banner e toast, analisi singola come run staccato.
  Smoke di tappa (agente separato, sessione `smoke-m3`): **0 BLOCKER, 1 MAJOR, 8 MINOR**, tutti corretti e
  ricontrollati nel browser; poi un passaggio `simplify` sul diff di M3 (4 revisori).

## Execution Mode

- `sequential` (PLAN G-3): un task alla volta nell'ordine di PLAN §8, stop alla fine di ogni tappa (M1, M2, M3) in
  attesa del via dell'utente. L'utente ha validato l'anteprima HTML delle tre tappe
  (https://claude.ai/artifact/F8nz41avEip8hUWFH853Co) senza modifiche il 2026-09-18.

## Deviations From the Plan

- T0: il branch `people-first-crm` è creato da `origin/main` ma senza upstream (`git branch --unset-upstream`): con
  l'upstream su `origin/main` un `git push` finirebbe su `main`.
- T1: CHECK della prossima azione `date(next_action_on) IS next_action_on` invece di `=` (PLAN §6): con `=` una data
  invalida (`date()` → NULL) rende il CHECK NULL, che SQLite fa passare.
- T1: `SchemaMigrationPlan.prospectsColumns` (colonne Apollo con ALTER) sparisce: la ricostruzione di `prospects`
  copia le colonne Apollo se ci sono e le crea se mancano (DB crm-foundation).
- T5: `PersonRef.first_source.label` è il tipo di fonte in italiano senza data ("commento", "persone di Acme"): la data
  la formatta la FE (fuso dell'utente). Nessuna nota dell'incontro se "Come vi siete conosciuti" è vuoto (C5 la chiede
  solo se compilato).
- T8: `view` assente nell'API = nessun filtro di vista (Lista e Azienda mostrano anche le scartate); la pagina Persone
  manda sempre `view` (`tutte` quando l'URL non la ha). Il PLAN (§12) diceva "assente = Tutte": vale per l'URL della FE.
- T8: `calendarDate` (zod) sta in `src/server/http.ts`, non in `routes/next-actions.ts`: evita un ciclo d'import fra
  router.
- T14: due piccole aggiunte server non scritte nel PLAN, necessarie ai testi del FLOW: `linkedin.member_urn_from`
  nell'anteprima di Unisci (*"con l'id membro di #812"*, F.3) e `mergeable`/`reason` per ogni persona nel 409
  `email_taken` (F.5: niente Unisci con due profili distinti anche nel caso email, senza una richiesta in più).
- T15: il promemoria *"Da completare"* dell'onboarding non ha "Nascondi" (P-15 lo prevede in Oggi, M2): l'onboarding
  sparisce con la prima persona. Il FLOW H.1 indica `/settings/profile#profilo` e `/companies?add=1`: in M1 i link
  vanno a `/settings#profilo` e `/settings#azienda` (P-24; `#azienda` è un'ancora nuova con focus sulla descrizione).
- T15: A3 esteso a qualche testo non elencato nella tabella del FLOW ma con la stessa parola: "sourcing" nei testi
  della lista archiviata e delle Impostazioni (→ *"persone di un'azienda"*), il riassunto del job *"Persone di
  <azienda>: …"* (era *"Sourcing <azienda> completato: …"*), l'export al femminile (*"Verranno esportate N
  persone"*). Restano "N selezionati" e simili, senza sostantivo.

- T17: `POST /jobs/:id/retry` resta com'era (ricontrolla solo i blocker di **configurazione**, PLAN "invariato"); i
  blocchi di dato del kind (es. "Nessun profilo da cercare" con Apollo, "Nessuna referenza da arricchire") compaiono
  nella preview di "Riprova…", dove disabilitano Avvia. Un test esistente (retry di un `enrich_companies` senza
  referenze → 202) lo richiede.
- T17: `enrich_companies` ricalcola la preview dallo stesso ambito (referenze dell'ICP o azienda del dettaglio); il
  job riprova gli id congelati ancora da arricchire, quindi se nel frattempo si aggiungono referenze la stima è un
  tetto (mai sotto la spesa). `lookalike_companies`: la pagina di partenza è quella congelata nel run; se una ricerca
  riuscita dopo il fallimento ha spostato la ripartenza, la preview lo dice (*"Riparte dalla pagina 1 come il run da
  riprovare (una ricerca nuova ripartirebbe dalla pagina 3)."*, nuovo `LookalikeInput.startPage`).
- T19: il CSV della lista ha una colonna nuova `fit_origin` (`tuo`/`AI`) dopo `fit` (F2: "ne indicano l'origine").
  L'etichetta dell'ordinamento diventa *"Fit (tuo o AI)"* e quelle del filtro *"Fit alto (tuo o AI)"* ecc.
- T22: nel combobox di ⌘K nessuna voce è attiva finché non si preme ↓ (FLOW B.3 "↓ Invio"); Invio senza voce attiva
  apre la prima. Seconda riga delle persone: ruolo · azienda, altrimenti headline, altrimenti **email** (non nel FLOW:
  distingue gli omonimi, es. le due Giulia Neri del seed; il server restituisce `email` nel risultato).
- T24: *"Persona scartata: la prossima azione non compare in Oggi."* sostituisce il testo di M1 (FLOW Edge). Tolta la
  `key` che rimontava la testata della prossima azione a ogni cambio di data (perdeva il focus dopo Rimanda).
- T26: le righe di *In arrivo* non hanno Fatto/Rimanda (H3 non li chiede; FLOW D.1 li mostra solo in Da fare).
- T27 (dallo smoke): il marchio della sidebar non è più un link (la home è la voce "Oggi"; TanStack marca sempre con
  `aria-current` un link attivo e non lo si può togliere); nella tabella Persone della scheda azienda non c'è più la
  colonna Azienda (tutte collegate a quell'azienda, D5). I bottoni in salvataggio usano `aria-disabled` invece di
  `disabled` (stile aggiunto a `Button`), così il focus non cade sul `body`.

- T28: `runOutcome`, `operationLabel` e `JOB_KIND_LABELS` stanno in `src/runs/outcome.ts` (nuovo), non in
  `src/runs/tools.ts` (T30): la riga finale del log li usa già, e una definizione sola evita che il testo dell'esito
  esista in due posti. `server/jobs.ts` ri-esporta `JOB_KIND_LABELS` per chi lo importava.
- T28: il troncamento del log (J11) avviene **in scrittura** (le righe centrali si cancellano a ogni lotto oltre le
  5.000), non in lettura: così un run occupa davvero al più ~10 MB e `omitted = MAX(seq) − COUNT(*)` come da P-10.

- T29: le righe di log dei kind si provano in un file nuovo (`tests/run-log-kinds.test.ts`) invece che dentro i test
  dei singoli kind: gli handler girano sulle deps fake del server e2e, così si verifica anche che reali e fake
  loggano uguale (P-11), in un posto solo.
- T29: il log del client Apollo è **iniettato** (`ApolloClientOptions.log`) invece di importare `runLog`:
  `scripts/apollo-smoke.ts` importa `src/apollo/client.ts` e importare il logger vi porterebbe dentro il DB
  (apertura e migrazione di `data/crm.db` durante uno smoke manuale).
- T29: i warning dell'esito diventano righe di log in `runJob`, non nei sette handler.

- T30: il filtro **Falliti** della pagina di uno strumento guarda l'esito del **run** (la colonna Esito), non
  l'attribuzione: un run che ha usato due strumenti ed è fallito per l'altro resta nell'elenco, e il dettaglio
  dice per chi conta ("Conta come fallito per: …"). Filtrare per attribuzione mostrerebbe "Tutti" con esiti
  Falliti che spariscono da "Falliti".
- T30: le viste dei run (`runView`, `runDetail`, `connections`) stanno in `src/db/runs.ts`, come `db/today.ts`
  fa per Oggi: la route resta sottile. `src/runs/tools.ts` resta puro (nessun DB), così l'attribuzione J4 si
  prova in vitest senza dati.
- T30: `legacyRunTools` (righe già concluse, da `result`/`error`) resta in `db/schema.ts` e **non** usa
  `toolsOf` dei kind: `schema.ts` è importato da `db/index.ts`, importare i job creerebbe un ciclo. Le due
  regole rispondono a domande diverse (all'avvio vs a cose fatte).

- T31: le tre sezioni delle Impostazioni **non** hanno il percorso "Impostazioni › …": la sotto-navigazione
  con `aria-current` dice già dove sei, e un segmento "Impostazioni" porterebbe a `/settings`, che
  reindirizza indietro (oltre a raddoppiare l'elemento marcato come pagina corrente). Il percorso c'è dove
  è un percorso vero: pagina di uno strumento e dettaglio di un run (T32, T33).
- T32: la pagina di uno strumento e il dettaglio del run mostrano, su un run fallito per un **altro**
  strumento, *"Errore di Anthropic"* / *"fallito per Anthropic, non per Apify"*. Il FLOW lo chiede solo
  nella riga della tabella, ma senza anche sulla card il badge "Fallito" sembrerebbe dello strumento
  sbagliato.

## Surprises and Decisions

- T1: `legacyRunTools` (strumenti dei run storici) vive in `src/db/schema.ts` e non in un modulo dei run: lo script di
  T2 deve importare solo `schema.ts` e le sue dipendenze senza DB.
- T2 (prova sulla copia del DB reale): tutto uguale (67 persone, 77 fonti, 85 attività, 12 analisi, 3 job, 1 azienda;
  FK 0; Inbox prima 0 = Da smistare dopo 0; nessuna azienda si accorcia con D5); file reali con stessa dimensione e
  mtime prima e dopo. **Il DB reale è ancora allo schema di crm-foundation**: il primo avvio dopo M1 migrerà anche
  companies, sources e jobs di apollo-lookalike, nella stessa transazione e con un solo backup.
- T4: l'unione automatica (`mergeProspects`) ora passa da `src/db/person-merge.ts` (`autoMergedValues` + `applyMerge`);
  lo stesso nucleo serve "Unisci" (T7). `nameTwin` non aggancia mai righe senza LinkedIn.
- T6: `no_linkedin` è una chiave nuova nei conteggi delle preview e dei job di arricchimento e analisi (sempre
  presente, anche a 0); `email_cleared` (D9) nella preview e nei conteggi dell'arricchimento Apollo.
- T7: la `patch` di "Unisci" usa gli stessi campi del PATCH (`patchFields` esportati da `routes/prospects.ts`); nel
  caso LinkedIn (E5) l'unione è rifiutata solo se gli id membro differiscono (l'URL della persona tenuta viene
  sostituito da quello che si sta salvando).
- T9: `fail-next` confronta il path senza query string; il server e2e ora è un'app esterna che delega a `createApp()`.
- T10–T13: i `Link` di TanStack prendono `aria-current` anche quando sono attivi "a spanne" (un prefisso del path):
  breadcrumb, viste e badge usano `activeOptions={{ exact: true, includeSearch: true }}`, altrimenti più voci
  risultano "pagina corrente".
- T14: i dialog senza `DialogTrigger` (Unisci) non ridanno il focus da soli: si salva l'elemento attivo all'apertura e
  lo si rifocalizza in `onCloseAutoFocus` (stesso schema di `JobPreviewDialog`). Il `sr-only` "Close" della X di
  shadcn diventa "Chiudi" (A3).
- T16 (dallo smoke): la ricerca confrontava l'URL grezzo; ora Persone e Aziende confrontano anche il profilo, il
  dominio e la pagina LinkedIn normalizzati (regola di identità). L'anteprima di Unisci ha `moving_labels` (fonti e
  ultima analisi per ICP in parole, FLOW F.3). Il picker d'azienda offre "Crea …" anche con risultati parziali (un
  solo picker, D3; il FLOW I.2 lo diceva solo per "nessun risultato") e Invio senza risultati non apre la creazione.
- T16: lo smoke l'ha fatto un agente separato (sessione `smoke-m1`) per non consumare il contesto dell'orchestratore;
  un `seed` lanciato per errore dall'orchestratore a metà giro è stato segnalato all'agente, che ha rifatto il passo.
- T17: tutti i kind avviati dalla loro route vera con un figlio finto che esce subito: il job diventa `failed` con i
  `params` che la route salva davvero, e il test confronta `retry-preview` con la preview della route alla stessa query.
- T19: `analysisStateSql` si sposta in `src/db/fits.ts` (dove sta anche `effectiveFitSql`) per evitare un ciclo
  d'import `prospects.ts` ↔ `fits.ts`; `prospects.ts` ne riesporta il tipo `AnalysisState`.
- T21: i tempi misurati su 10.000 persone e 2.000 aziende sono molto sotto le soglie (ricerca 8–10 ms lato server,
  110–125 ms dall'ultimo tasto ai risultati con il debounce di 80 ms; Persone 5 ms; ordinamento per fit 8 ms).
- T22: i dialog Radix sono `position: fixed` → `offsetParent` è sempre `null`: il controllo "c'è già un dialog
  aperto" di ⌘K usa `getClientRects()` (bug trovato nel browser e corretto).
- T23: `next_action_set_at` fa da controllo di concorrenza ("cambiata altrove"): cresce sempre, anche con due
  scritture nello stesso millisecondo.
- T27 (`simplify`): lo stato AI delle righe si calcola con le sottoquery a finestra ristrette agli id della pagina
  (prima leggevano tutte le analisi e i fallimenti) e il fit effettivo delle righe si ricava da stato AI e fit manuale
  già letti (`effectiveFit`), invece di una seconda query identica; la ricerca globale legge ogni gruppo una volta sola
  (`COUNT(*) OVER ()`). Non applicati (annotati): ordinamento per fit con la sottoquery correlata (~14 ms su 10.000,
  dentro il budget), un prop `pending` su `Button` al posto delle guardie per bottone, una condizione di testo
  condivisa tra ricerca aziende e filtro di Aziende (cambierebbe l'escape di `%`/`_` nel filtro esistente).
- Validazione M2 con agent-browser: i radio controllati da React non cambiano con `check`, e il bottone "Riprova…" del
  banner su un viewport basso sta sotto la piega dentro il banner scorrevole: in entrambi i casi click via `eval`.
- Validazione con agent-browser: `fill` con stringa vuota non manda l'evento di cambio a React (il campo sembra vuoto
  ma lo stato no): per svuotare un campo si usa `press End` + `Backspace`. I click su elementi fuori viewport vanno
  preceduti da `scrollintoview`.

- T28: leggere il log di un run rimasto `running` senza pid lo **riconcilia** (`getJob` → `reconcileRunning`) e gli
  aggiunge la riga *"Fine: fallito — process: …"*. È il comportamento voluto (J8: il dettaglio dice sempre com'è
  finito), ma significa che un run va chiuso prima di leggerne il log nei test.

- T33: in `agent-browser` il focus non torna sul bottone dopo la chiusura di un dialog Radix (la pagina è
  `visibilityState=hidden`, l'animazione d'uscita non finisce): stesso comportamento sul dialog del banner
  già validato in M2, quindi è l'ambiente, non la pagina. Verificato mantenendo il dialog **montato**
  (smontarlo alla chiusura toglierebbe davvero a Radix il bottone a cui restituire il focus).

- T35: `withRunLog` accetta anche un run il cui id arriva dopo (`LazyRun`). Serviva a P-13: l'analisi singola
  deve poter scrivere *"Avvio: Analisi singola"* prima di sapere se creerà un run, e non crearlo se non
  chiama nessuno strumento. Le righe in coda si buttano se il run non nasce.
- T35: l'esito del run di un'analisi singola segue J4 anche quando la risposta HTTP è un errore: un rifiuto
  del modello è *"completato con avvisi"* per il run (lo strumento ha risposto) ma resta un 502 per chi ha
  premuto "Analizza".

### Passaggio `simplify` su M3 (2026-09-20): cosa è stato lasciato com'è

- **Tre grammatiche dell'esito nel frontend** (banner/`companies.$id` su `jobOutcomeTone`, Connessioni su
  `RunOutcome` del server): un job a zero risultati resta *"Nessun risultato"* nel banner e *"Completato"* in
  Connessioni. J4 definisce **tre** esiti e il riassunto della riga dice già che non ha trovato niente:
  aggiungere un quarto esito lato server contraddirebbe la SPEC.
- **`legacyRunTools` in `db/schema.ts`** (strumenti dedotti dai dati salvati) accanto a `toolsOf` dei kind: la
  regola è la stessa vista da due momenti diversi (all'avvio vs a cose fatte) e `schema.ts` non può importare
  i job senza ciclo. Spostarla richiederebbe di togliere il backfill dalla migrazione, che il PLAN (§6, P-1)
  mette lì e che sul DB dell'utente è già passato.
- **Durata**: *"4 s" / "2 min 05 s"* negli elenchi dei run e *"0:05"* nel banner. Sono due letture diverse
  (una tabella e un cronometro): `formatDuration` resta al banner.
- **Due polling sul dettaglio di un run in corso** (run e log, 2 s ciascuno verso `localhost`): unirli
  aggiunge un'invalidazione a mano per risparmiare una richiesta al secondo.
- **`th`/`td` ripetuti nel repo** (`ui.tsx`, `icps.index`, `companies.index`, `settings/parts`): M3 ha tolto
  la **sua** copia; unificare le quattro preesistenti è un intervento fuori tappa (i `td` non coincidono).

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| Baseline (T0): `npm run typecheck`, `npm test`, web build, web typecheck | ✓ | 37 file / 520 test |
| T1: `npm test` | ✓ | 525 test |
| T2: `npm run db:migration-check -- data/crm.db` (copia in tmp) | ✓ | report di soli numeri, file reali invariati |
| T3–T9: typecheck + `npm test` dopo ogni task | ✓ | 579 test dopo T9 |
| T9: `curl` su `fail-next` (server e2e :8833, fermato per PID) | ✓ | 500→201; `times: 2` → 500, 500, 200 |
| T10–T13: web typecheck + agent-browser sul server e2e (:8841 + Vite :5191) | ✓ | righe d'errore del FLOW A, B, C, I |
| T14: `npm test` (api-people-identity) + agent-browser | ✓ | F.1–F.5 e righe "Unisci: sparita / 500", E3, E4, E7 |
| T15: 4 gate + checklist `rg` + agent-browser | ✓ | 44 file / 579 test; onboarding a DB vuoto, `/` → `/people`, testo di 12 pagine |
| T16: smoke M1 (`tests/e2e/smoke-people.md`) | ✓ | 0 BLOCKER; MAJOR corretti e ricontrollati nel browser |
| T16: 4 gate finali | ✓ | 44 file / 579 test, build e typecheck web |
| M2 ripresa (T17): `lsof data/crm.db data/crm.db-wal`, `pgrep` | ✓ | nessun processo sul DB reale |
| T17: `npm test` (jobs) + typecheck | ✓ | 583 test |
| T18: agent-browser (e2e :8851 + Vite :5201) + build/typecheck web | ✓ | banner e "Ultimi job", blocchi, corsa 409 |
| T19: `npm test` (api-fits, list-export) + typecheck | ✓ | 592 test |
| T20: agent-browser + build/typecheck web | ✓ | card, colonna, `fail-next` su PUT fit, Elimina ICP, F9 |
| T21: `npm test` (api-search, perf-people) + typecheck | ✓ | 598 test; tempi nel log di T21 |
| T22: agent-browser (anche `seed-bulk`) + build/typecheck web | ✓ | latenza 108–124 ms dall'ultimo tasto |
| T23: `npm test` (api-next-actions) + typecheck | ✓ | 601 test |
| T24: agent-browser + build/typecheck web | ✓ | Fatto, Rimanda, "cambiata altrove", touchpoint |
| T25: `npm test` (api-today) + typecheck | ✓ | 604 test |
| T26: agent-browser + build/typecheck web | ✓ | Oggi, Nascondi, focus, onboarding |
| T27: smoke M2 (`tests/e2e/smoke-people.md`, sezione M2) | ✓ | 0 BLOCKER · 0 MAJOR · 6 MINOR, corretti e ricontrollati |
| T27: 4 gate finali (dopo correzioni e `simplify`) | ✓ | 49 file / 604 test, build e typecheck web |
| T28: ripresa M3 — server reale fermato per PID, `lsof` sul DB vuoto | ✓ | nessun job in corso, porte 8787/5173 libere |
| T28: `npm test` (run-log) + typecheck | ✓ | 50 file / 612 test |
| T29: `npm test` (run-log-kinds) + typecheck | ✓ | 51 file / 619 test |
| T30: `npm test` (api-runs, e2e-deps) + typecheck | ✓ | 52 file / 629 test |
| T31: agent-browser (sessione `t28`) + build/typecheck web | ✓ | redirect con ancora, sotto-navigazione, tre sezioni |
| T32: agent-browser + build/typecheck web | ✓ | card, Vedi run, filtro Falliti, 404 strumento, `fail-next` |
| T33: agent-browser + build/typecheck web | ✓ | log live, `fail-next` sul log, `LOG_FLOOD`, Riprova… con blocco |
| T34: `npm test` (api-today) + agent-browser | ✓ | avvisi in Oggi, "Dettagli del run" in banner e toast |
| T35: `npm test` (analyze) + agent-browser | ✓ | 633 test; run staccato, 409 not_retryable, J13 |
| T36: smoke M3 (`tests/e2e/smoke-people.md`, sezione M3) | ✓ | 0 BLOCKER · 1 MAJOR · 8 MINOR, corretti e ricontrollati |
| T36: avvio su una **copia** di `data/crm.db` (server su porta scratch) | ✓ | `fillMissingRunTools` riempie 1 run, Connessioni mostra i 4 run reali attribuiti |
| T36: 4 gate finali (dopo correzioni e `simplify`) | ✓ | 52 file / 633 test, build e typecheck web |

## Pre-existing Issues

- `tests/analyze.test.ts` › *"latest, history, stale dopo il cambio profilo…"* è instabile: in un giro su cinque
  l'analisi fallita e quella salvata hanno lo stesso `created_at` al millisecondo e lo stato non diventa `rifiutata`
  (confronto `fa.created_at > an.created_at` in `analysisStateSql`, ora in `src/db/fits.ts`). Non toccato da questo
  piano; in M2 un fallimento isolato su una ventina di giri della suite, non riprodotto.

## Remaining Work

- Spec implementata per intero (M1–M3). Restano, in ordine: decidere cosa fare dei MINOR aperti qui sotto, il
  walkthrough `ux-advisor` sull'app viva (`UX-REVIEW.md`) e, a prodotto fermo, `adversarial-review` in una
  **sessione nuova**. Niente è committato: il commit lo chiede l'utente.
- MINOR aperti dallo smoke M3: nessuno (tutti corretti). Due percorsi non verificabili con agent-browser sul server
  e2e, implementati ma non provati a mano: l'avviso di un run **non attribuibile** (*"…per Apify e Anthropic"*, serve
  un errore `process:`) e la persistenza del log **dopo un riavvio del server** (il server e2e azzera il DB all'avvio;
  sul DB reale le righe restano, `run_logs` è una tabella come le altre).
- MINOR aperti dallo smoke M1: focus dopo alcuni esiti asincroni (salvataggio fallito, corsa C7, persona o azienda
  sparite, "Resta" del guard d'uscita, Collega/Scollega, Rimuovi prossima azione, bulk "Aggiungi a lista"); prefisso
  "Il dominio …" nel conflitto di "Crea l'azienda"; avviso bulk "N persone selezionate hanno una prossima azione".
- Il primo avvio sul DB reale dopo M1 fa il backup `data/crm.db.bak-<ISO>` e migra in una transazione (anche lo schema
  di apollo-lookalike, vedi T2).
- Post-implementazione (fine spec, dopo M3): walkthrough `ux-advisor` → `UX-REVIEW.md`; `adversarial-review` solo in
  una sessione separata.
