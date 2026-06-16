---
domain: lead-engine
type: concept
links: []
created: 2026-06-12
updated: 2026-06-16
ingested: false
last_ingested: null
---

# 01 — Architettura

## Stack

- **Runtime**: TypeScript + Node ≥ 20, eseguito con `tsx` (niente build per la CLI)
- **Storage**: SQLite via `better-sqlite3` (sincrono, WAL), unico file `data/sevedemo.db`
- **Estrazione/enrichment**: actor Apify di terze parti via `apify-client`
- **Classificazione e copywriting**: Claude via `@anthropic-ai/sdk` (Haiku per lo scoring, Sonnet per le email)
- **CLI**: `commander` (`src/cli.ts`)
- **Web UI**: API **Hono** (`src/server/`, porta 8787) + frontend React 19 / TanStack Router & Query /
  Tailwind 4 / Vite in `web/` (workspace npm separato)
- **Validazione**: `zod` (output dei modelli e body delle API)
- **Concorrenza**: `p-limit` (chiamate Claude)

## Layout del repo

```
src/
  cli.ts               # entry point CLI (commander)
  config.ts            # config da env (.env via dotenv) con default
  apify/
    client.ts          # wrapper runActor (bloccante, singleton lazy)
    actors.ts          # ID actor + builder degli input — UNICO punto da toccare se cambiano gli schemi
  strategies/          # plug-in di estrazione (vedi doc 03)
    types.ts           # interface Strategy + RawCandidate
    registry.ts        # elenco strategie, gating cookie
    seeds.ts           # caricamento file da data/seeds/
    people-search.ts   # factory people-search + rotazione query
    *.ts               # le 5 strategie concrete
  pipeline/
    run.ts             # orchestrazione runDaily / runStrategy
    select.ts          # selectBucket (20+20 con cap per settore)
  enrich/profile.ts    # enrichment via actor dev_fusion
  score/
    rubric.ts          # system prompt ICP + schema tool classify_profile + buildProfileText
    claude.ts          # scoreOne / scoreMany (Haiku, tool-use forzato, zod)
  email/draft.ts       # draftOne / draftMany (Sonnet, tool-use forzato, zod)
  export/csv.ts        # toCsv + exportContacts (CSV + JSON in exports/)
  eval/
    import.ts          # importOutcomes (CSV del tool email → tabella outcomes)
    report.ts          # printStrategyReport (tabella console)
  db/
    index.ts           # apertura DB + schema (applicato all'import, idempotente)
    contacts.ts        # CRUD contatti + transizioni di stato
    runs.ts            # runs, daily_selection, outcomes, reportByStrategy
    kv.ts              # stato chiave/valore persistente (cursori di rotazione)
  util/
    fields.ts          # field() multi-chiave, normalizeLinkedinUrl, truncate
    csv.ts             # parseCsv, truthy (per eval:import)
  server/
    index.ts           # API Hono + serving statico di web/dist
    queries.ts         # query SQL dedicate alla UI
data/
  seeds/               # query e seed modificabili senza ricompilare
  sevedemo.db          # database (creato al primo avvio)
web/                   # frontend (workspace separato, vedi doc 07)
exports/               # output CSV/JSON
scripts/seed-demo.ts   # dati demo per provare la UI a DB vuoto
```

## Entry point e comandi

`src/cli.ts` è costruito con **commander** e definisce 6 comandi (tutti via `npm run cli <cmd>`).
La CLI non contiene logica: ogni comando è un **wrapper sottilissimo** che fa parsing degli
argomenti, chiama una funzione dei moduli interni e stampa il risultato.

| Comando | Cosa chiama | Note |
|---|---|---|
| `db:init` | niente | **no-op consapevole**: lo schema viene applicato all'`import` di `db/index.ts` (`db.exec(SCHEMA)` al caricamento del modulo), quindi *qualsiasi* comando inizializza il DB; questo esiste solo per farlo esplicitamente e stampare il path |
| `strategies` | `listStrategies()` + `isEnabled()` | elenca le 5 strategie con stato `ATTIVA` / `gated (manca LINKEDIN_LI_AT)` |
| `pipeline --daily` | `runDaily()` | run completo: estrazione mix strategie → 20+20 → email → export |
| `pipeline --strategy <id> --limit <n>` | `runStrategy(id, limit)` | una sola strategia (accumulo dati di confronto, non produce i 40); default limit = `POOL_SIZE` |
| `export --date YYYY-MM-DD` | `getSelection(date)` + `exportContacts(...)` | ri-esporta la selezione di un giorno (rilegge `daily_selection`); default `today()` |
| `eval:import <file.csv>` | `importOutcomes(file)` | importa gli esiti outreach (vedi doc 06) |
| `eval:report` | `printStrategyReport()` | tabella di confronto strategie (vedi doc 06) |

Dettagli pratici:

- da npm serve il doppio `--`: `npm run cli pipeline -- --daily` (il primo separa gli argomenti di
  npm da quelli dello script);
- gli errori in `pipeline` vengono catturati e stampati con `process.exitCode = 1`: exit code
  corretto per chi incatena il comando in uno script.

## Orchestrazione della pipeline (`src/pipeline/run.ts`)

### `runDaily()`

```
1. gather(dailyStrategies(), POOL_SIZE)   # budget diviso equamente: ceil(200 / n strategie attive)
2. persist(candidates)                     # upsert in contacts; tiene solo nuovi o stale (>90gg)
3. prefilter(toProcess, ENRICH_CAP)        # conteggio keyword sull'headline, tiene i migliori 120
4. enrichAndScore(prefiltered)             # vedi doc 04
5. selectBucket × 2 → saveSelection(run_id) # Selezione figlia del Run, state 'in_review' (doc 05)
6. draftMany → updateEmail                  # bozze email
7. exportContacts → CSV                      # state → 'exported' è azione esplicita, non qui
8. logRun per strategia                    # telemetria itemsIn/itemsNew in tabella runs
```

Punti chiave di `gather` (`run.ts:46`):
- ogni `strategy.source(limit)` è avvolta in try/catch: **una strategia che fallisce rende 0
  candidati ma il run prosegue** con le altre;
- dedup cross-strategia in-memory per URL normalizzato (vince chi arriva prima).

Punti chiave di `persist` (`run.ts:75`):
- `upsertCandidate` inserisce i nuovi con status `new`; per gli esistenti fa solo backfill leggero
  di nome/headline (senza toccare lo scoring);
- prosegue nel funnel solo chi è nuovo **oppure** non più fresco (`isFresh` su `last_evaluated_at`).

`prefilter` (`run.ts:99`) è un filtro a costo zero: conta le keyword (freelance + azienda + settore)
presenti nell'headline e tiene i top `ENRICH_CAP`. Serve a contenere il costo dell'enrichment, il
passo Apify più caro per profilo.

### Cosa significa «daily» (spoiler: non c'è uno scheduler)

`runDaily` è una **funzione batch one-shot**: parte, attraversa gli 8 passi in sequenza, scrive i
file e termina il processo. Nel repo non esistono scheduler, cron, daemon o processi residenti —
niente parte da solo, mai. "Daily" è una **convenzione di design, non un meccanismo**, e significa
tre cose precise:

1. **È calibrato per essere lanciato una volta al giorno.** Tutti i numeri del sistema sono tarati
   su quella cadenza: 200 candidati, cap di 120 enrichment (~$2), 20+20 selezionati, ~$5/mese di
   scoring. È il *ritmo previsto*, ma chi lo rispetta è l'operatore (o un cron suo, esterno al repo).
2. **La data è una chiave di partizionamento, non un trigger.** La prima riga di `runDaily` è
   `const date = today()` (`db/index.ts`): la data viene calcolata **al momento del lancio** e
   quella stringa finisce in tre posti — `daily_selection.date` (la selezione "del giorno"),
   `runs.run_date` (la telemetria) e il nome file `daily-<data>.csv`. Il giorno solare è l'unità
   con cui il sistema organizza i propri artefatti; la pagina *Selezioni* della UI è esattamente
   la lista di queste date.
3. **Se non lo lanci, non succede niente.** Saltare un giorno non produce recuperi, code o
   arretrati: quel giorno semplicemente non esiste nel DB. Il sistema è puramente *pull*.

⚠️ `today()` usa `toISOString()`, quindi è la **data UTC**, non quella italiana: un run lanciato
alle 00:30 ora italiana (estate) per il sistema è ancora "ieri". Irrilevante per un uso diurno, ma
spiega eventuali date "sbagliate" su run notturni.

**Doppio run nello stesso giorno** — il modello post-remodel ne cambia l'esito:

- `saveSelection` è DELETE + INSERT **sulla data** (doc 05): la seconda esecuzione **sostituisce** la
  `daily_selection` del giorno (anche con un `run_id` nuovo, la chiave di rimpiazzo resta la data);
- i contatti del primo run **non** sono più marcati `exported` (il run non esporta): tornati
  **non-membri** dopo il DELETE, rientrano nel pool eleggibile e il secondo run può ri-selezionarli in
  base al fit;
- `daily-<data>.csv` ha lo stesso nome → viene **sovrascritto** con i nuovi 40.

⚠️ La garanzia "max una email" è ancorata alla **membership di una Selezione `exported`**: vale finché
l'operatore esporta una Selezione al giorno (le Selezioni `exported` non vengono mai ri-bersagliate). Un
secondo run *non esportato* nello stesso giorno è l'unico caso che rimette in gioco i contatti del primo.
Vedi [[concepts/modello-stati-membership]].

**Cosa rende un run diverso dal precedente** — tre meccanismi cooperano perché lanci consecutivi
non ricomprino le stesse cose:

1. **rotazione delle query** (doc 03): il cursore in `kv` avanza a ogni run riuscito, le
   people-search partono da query diverse;
2. **freshness** (90 giorni): un profilo già valutato viene scartato in `persist` senza pagare né
   Apify né Claude;
3. **avanzamento di status**: chi è stato selezionato/esportato non rientra mai nel pool.

**Per automatizzarlo davvero**, un cron di sistema (o `launchd` su macOS), fuori dal repo:

```cron
0 8 * * 1-5  cd /path/sevedemo-tools && npm run cli pipeline -- --daily >> logs/daily.log 2>&1
```

L'assenza di scheduler è coerente col resto del design (come l'evaluation manuale, doc 06): il
sistema esegue, **l'operatore decide quando** — anche perché ogni run costa soldi veri su Apify, e
un cron dimenticato è un costo che corre da solo.

### `runStrategy(id, limit)`

Condivide i primi 4 passi del funnel (gather → persist → prefilter → enrichAndScore) ma **si ferma
lì**: niente selezione 20+20, niente email, non tocca `daily_selection`. Esporta direttamente i
profili scored del run come `strategy-<id>-<data>.csv|json` e logga in `runs`. Serve ad accumulare
dati di confronto tra strategie (vedi doc 06) senza "consumare" il giorno.

## Configurazione (`src/config.ts`)

Tutto da `.env` (caricato con dotenv), con default sensati:

| Variabile | Default | Uso |
|---|---|---|
| `APIFY_TOKEN` | — (obbligatoria) | client Apify (`requireApify` fallisce con messaggio chiaro) |
| `ANTHROPIC_API_KEY` | — (obbligatoria) | client Claude |
| `LINKEDIN_LI_AT` | vuota | se assente, le 2 strategie cookie restano disabilitate |
| `SCORING_MODEL` | `claude-haiku-4-5-20251001` | classificazione profili |
| `EMAIL_MODEL` | `claude-sonnet-4-6` | bozze email |
| `POOL_SIZE` | 200 | candidati totali del run giornaliero |
| `ENRICH_CAP` | 120 | max profili arricchiti per run |
| `TARGET_FREELANCE` / `TARGET_AZIENDA` | 20 / 20 | dimensione selezione |
| `MIN_FIT_SCORE` | 50 | soglia minima per entrare in selezione |
| `FRESHNESS_DAYS` | 90 | finestra entro cui un profilo non viene rivalutato |
| `SCORING_CONCURRENCY` | 6 | chiamate Claude in volo (sia scoring sia email) |
| `COOKIE_MAX_PROFILES` | 100 | cap conservativo per le strategie cookie |
| `DB_PATH` | `data/sevedemo.db` | per puntare a un DB diverso (es. demo) |
| `UI_PORT` | 8787 | porta dell'API Hono |

## Ciclo di vita di un contatto

Due dimensioni **separate** (remodel; canonico in [[concepts/modello-stati-membership]]):

```
# stadio del dato — contacts.status
new ──(updateEnrichment)──▶ enriched ──(updateScore)──▶ scored
                                          └─(gate geo)─▶ rejected_geo / discarded

# ciclo cold-email — daily_selection.state (NON sul contatto)
in_review ──(azione "Esporta")──▶ exported
```

- `contacts.status` è **solo lo stadio del dato** (`new|enriched|scored|discarded|rejected_geo`):
  `selected`/`exported` **non esistono più** sul contatto.
- Un contatto `scored` non selezionato **resta nel pool**: concorre alle selezioni dei giorni
  successivi (la selezione pesca da tutto il DB, non solo dal run di oggi).
- L'eleggibilità è **membership-derived**: `selectBucket` esclude chi è già in una qualsiasi
  `daily_selection` (`id NOT IN (SELECT contact_id FROM daily_selection)`) → ogni contatto riceve la
  cold-email al massimo una volta; rimuoverlo da una Selezione lo rende di nuovo eleggibile.
- Un contatto il cui scoring fallisce resta `enriched` e verrà ritentato a un run futuro
  (non avendo `last_evaluated_at`, non è mai "fresco").

## Gestione errori — filosofia

Fail-fast solo su configurazione (token mancanti, seed vuoti/illeggibili). Tutto il resto è
best-effort con isolamento per item: strategia, profilo, scoring e bozza email falliscono
singolarmente con warning a log, mai l'intero run. Le chiavi esterne (URL, campi degli actor)
si leggono sempre in modo tollerante (`field(...)` con nomi alternativi).
