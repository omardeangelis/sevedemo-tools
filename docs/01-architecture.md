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

`src/cli.ts` definisce i comandi (tutti via `npm run cli <cmd>`):

| Comando | Cosa fa |
|---|---|
| `db:init` | Crea/aggiorna lo schema (in realtà lo fa già l'import di `db/index.ts`; il comando è un no-op esplicito) |
| `strategies` | Elenca le 5 strategie con stato attiva/gated |
| `pipeline --daily` | Run completo: estrazione mix strategie → 20+20 → email → export |
| `pipeline --strategy <id> --limit <n>` | Run di una sola strategia (accumulo dati di confronto, non produce i 40) |
| `export --date YYYY-MM-DD` | Ri-esporta la selezione di un giorno (rilegge `daily_selection`) |
| `eval:import <file.csv>` | Importa gli esiti outreach (vedi doc 06) |
| `eval:report` | Tabella di confronto strategie (vedi doc 06) |

Non esiste scheduler nel repo: il run giornaliero va lanciato dall'operatore (o da un cron esterno).

## Orchestrazione della pipeline (`src/pipeline/run.ts`)

### `runDaily()`

```
1. gather(dailyStrategies(), POOL_SIZE)   # budget diviso equamente: ceil(200 / n strategie attive)
2. persist(candidates)                     # upsert in contacts; tiene solo nuovi o stale (>90gg)
3. prefilter(toProcess, ENRICH_CAP)        # conteggio keyword sull'headline, tiene i migliori 120
4. enrichAndScore(prefiltered)             # vedi doc 04
5. selectBucket × 2 → saveSelection        # vedi doc 05
6. draftMany → updateEmail                 # bozze email
7. exportContacts → status 'exported'
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

### `runStrategy(id, limit)`

Stesso funnel ma su una sola strategia, senza selezione 20+20 e senza email: esporta direttamente i
profili scored come `strategy-<id>-<data>.csv|json`. Serve ad accumulare dati di confronto tra
strategie (vedi doc 06).

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

```
new ──(updateEnrichment)──▶ enriched ──(updateScore)──▶ scored
        ──(saveSelection + setStatus)──▶ selected ──(export)──▶ exported
```

- Un contatto `scored` non selezionato **resta nel pool**: concorre alle selezioni dei giorni
  successivi (la selezione pesca da tutto il DB, non solo dal run di oggi).
- Un contatto `selected`/`exported` esce dal pool per sempre: il filtro `status = 'scored'` di
  `selectBucket` garantisce che riceva la cold-email al massimo una volta.
- Un contatto il cui scoring fallisce resta `enriched` e verrà ritentato a un run futuro
  (non avendo `last_evaluated_at`, non è mai "fresco").

## Gestione errori — filosofia

Fail-fast solo su configurazione (token mancanti, seed vuoti/illeggibili). Tutto il resto è
best-effort con isolamento per item: strategia, profilo, scoring e bozza email falliscono
singolarmente con warning a log, mai l'intero run. Le chiavi esterne (URL, campi degli actor)
si leggono sempre in modo tollerante (`field(...)` con nomi alternativi).
