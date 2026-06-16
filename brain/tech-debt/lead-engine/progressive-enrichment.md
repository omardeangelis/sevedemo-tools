---
domain: lead-engine
type: tech-debt
spec: progressive-enrichment
links:
  - "[[specs/lead-engine/progressive-enrichment/SPEC]]"
created: 2026-06-15
updated: 2026-06-15
---

# Tech debt — progressive-enrichment

Drift durevole emerso durante l'implementazione di [[specs/lead-engine/progressive-enrichment/SPEC]].

## TD-1 — `scripts/seed-demo.ts` non aggiornato al remodel degli stati

Il seed demo è **pre-remodel**: inserisce le righe `runs`/`daily_selection` senza `run_id`
e imposta sui contatti gli status legacy `selected`/`exported` (non più nel modello
`new→enriched→scored→discarded→rejected_geo`).

- **Impatto:** non rompe nulla (migrazione idempotente + UI tollerante ai legacy:
  i run senza `run_id` si raggruppano per data, la Selezione mostra "legacy / nessun Run").
  Ma i dati demo **non** esercitano la provenienza `run_id`, lo stato `in_review→exported`,
  né i derivati di enrichment (`last_enrichment_attempt_at`).
- **Fix proposto (chore separato):** riscrivere il seed sul nuovo modello — `newRunId` +
  `saveSelection(date, rows, runId)` + `setSelectionExported` per una selezione, contatti
  con/senza email e qualche `last_enrichment_attempt_at` per i derivati. Riferimento di forma:
  il seed temporaneo usato nel walkthrough browser (rimosso a fine task).

## TD-2 — Fork storico del predicato "email presente" (pre-esistente)

`hasEmail` (trim, guard bozze) vs predicato non-trim (segmentazione/`withEmail`). Questa spec
**non** lo unifica (scelta esplicita): per un'email reale appena recuperata le definizioni
coincidono. Vedi anche [[tech-debt/lead-engine/email-segmentation-filters]] (TD-1).
