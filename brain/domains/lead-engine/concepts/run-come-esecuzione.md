---
domain: lead-engine
type: concept
status: implemented
ingested: true
last_ingested: 2026-06-15
links: []
created: 2026-06-15
updated: 2026-06-15
---

# Concetto — Run come esecuzione (`run_id`)

## Definition

Il **Run** è l'**esecuzione di `runDaily`**, non la singola riga di strategia. La tabella `runs` ha una
riga **per strategia per data**, quindi "il Run" è l'evento che scrive **N righe `runs`** (una per
strategia attiva) **+ una `daily_selection`**. Per legarle si introduce un'identità di prima classe: il
**`run_id` reale**, formato `YYYY-MM-DD-N` dove `N` è progressivo nel giorno (`newRunId`, `src/db/runs.ts`).
Lo stesso `run_id` è scritto sulle righe `runs` (`logRun`) e sulla `daily_selection` (`saveSelection`),
così la Selezione può puntare al Run che l'ha generata e **due run nello stesso giorno restano distinti**.

Questo è il riferimento `run_id`-equivalente richiesto dalla SPEC: rende il Run un'entità a cui la
Selezione **appartiene** (è "figlia del Run" — vedi [[selezione-figlia-del-run]]). Da non confondere con
`actor_run_id`, che è l'id di run **di Apify** (tracciabilità dell'actor), distinto e indipendente.

## Attributes

| Attributo | Valore |
|-----------|--------|
| Cos'è "il Run" | l'esecuzione di `runDaily` = N righe `runs` (una per strategia) + 1 `daily_selection` |
| Identità | `run_id` reale, `YYYY-MM-DD-N` (`N` = `COUNT(DISTINCT run_id)` del giorno + 1) |
| Generatore | `newRunId(date)` (`src/db/runs.ts`), chiamato a inizio run prima di `logRun` |
| Dove è scritto | colonna `runs.run_id` (via `logRun`) **e** `daily_selection.run_id` (via `saveSelection`) |
| Indici | `idx_runs_run_id`, `idx_daily_selection_run_id` (migrazione, `src/db/index.ts`) |
| `actor_run_id` | **diverso**: id del run Apify dell'actor; tracciabilità esterna, non l'identità del Run |
| Pagina Run | `listRunExecutions` raggruppa per `COALESCE(run_id, 'date:'||run_date)` → una card per esecuzione |
| Run legacy | righe pre-remodel senza `run_id` → raggruppate per **data** (`d.run_id IS NULL AND d.date = ?`) |
| Forma esposta | `RunExecution { run_id, run_date, strategies: string[], …, selection: {date,state,total,ready,toEnrich}\|null }` |
| Provenienza | `getSelectionMeta(date)` → `{run_id, state}`: dalla Selezione si raggiunge il Run (bidirezionale) |

## Related flows

- [[selezione-figlia-del-run]] — generazione della Selezione figlia, provenienza Run ↔ Selezione, export.
- [[modello-stati-membership]] — perché eleggibilità e "già contattato" sono membership-derived e non
  più status del contatto.

## [Source: SPEC + IMPLEMENTATION-NOTES progressive-enrichment]

- **Decisione (utente, fase di plan):** Run identity = `run_id` reale per esecuzione (Opzione A), non un
  set per-contatto né una tabella di join. "I contatti del Run" = migliori eleggibili del momento (nuovi
  + riserva); la Selezione porta solo il `run_id` di provenienza.
- **T3:** `newRunId`/`saveSelection(date, rows, runId)`/`logRun` con `run_id`; verificato in
  `tests/run-id-selection.test.ts`.
- **T7/T8:** `listRunExecutions` + `runs.tsx` raggruppano per esecuzione; smoke reale 2026-06-15 ha
  prodotto un `run_id` vero (`2026-06-15-…`) con la Selezione come figlio.
