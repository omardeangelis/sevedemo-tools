---
domain: lead-engine
type: implementation-notes
spec: progressive-enrichment
links:
  - "[[specs/lead-engine/progressive-enrichment/SPEC]]"
  - "[[specs/lead-engine/progressive-enrichment/PLAN]]"
  - "[[domains/lead-engine/flows/enrichment-progressivo-email]]"
  - "[[domains/lead-engine/flows/selezione-figlia-del-run]]"
  - "[[domains/lead-engine/concepts/modello-stati-membership]]"
  - "[[domains/lead-engine/concepts/run-come-esecuzione]]"
  - "[[domains/lead-engine/concepts/enrichment-progressivo-apimaestro]]"
ingested: true
last_ingested: 2026-06-15
created: 2026-06-14
updated: 2026-06-15
---

# Implementation Notes

## Summary

- Esecuzione del PLAN per `progressive-enrichment`: enrichment progressivo on-demand (actor `apimaestro/linkedin-profile-detail`), Selezione figlia del Run (`run_id` reale), e remodel degli stati (`contacts.status` = stadio-dato; Selezione con ciclo `in_review → exported`; eleggibilità membership-derived).

## Execution Mode

- **sequential** — grafo quasi lineare (schema → modello → API → UI) con file caldi condivisi (`app.ts`, `run.ts`, `contacts.ts`, `web/src/api/*`). Un task alla volta in ordine topologico: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9.

## Deviations From the Plan

- **T2** — Aggiungere i due campi a `ContactRow` ha rotto due factory di test pre-esistenti (`email-draft-guard.test.ts`, `italy-geo-gate.test.ts`) che costruiscono `ContactRow` letterali: aggiunti `last_enrichment_attempt_at: null` / `last_enrichment_actor: null` (richiesto da gate typecheck, non da comportamento).

## Surprises and Decisions

- **T1** — `SCHEMA` (CREATE TABLE) lasciato invariato; tutte le colonne nuove sono aggiunte solo via `migrate()`/`ensureColumn`, così la definizione vive in un unico punto. Remap legacy guardato da `addedState` (prima comparsa di `daily_selection.state`) **e** naturalmente idempotente per ordine delle UPDATE → una selezione `exported` del nuovo modello non viene mai regredita.

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| `npm test` dopo T1 | ✅ 56/56 | +3 (`tests/migration.test.ts`) |
| `npm run typecheck` dopo T1 | ✅ | clean |
| `npm test` dopo T2 | ✅ 60/60 | +4 (`tests/contacts-progressive.test.ts`) |
| `npm run typecheck` dopo T2 | ✅ | clean (dopo fix factory) |
| `npm test` dopo T3 | ✅ 63/63 | +3 (`tests/run-id-selection.test.ts`) |
| `npm run typecheck` dopo T3 | ✅ | clean |
| `npm test` dopo T4 | ✅ 68/68 | +5 (`tests/profile-detail.test.ts`) |
| `npm run typecheck` dopo T4 | ✅ | clean |
| `npm test` dopo T5 | ✅ 71/71 | +3 (`tests/enrich-selection.test.ts`) |
| `npm run typecheck` dopo T5 | ✅ | clean |
| `npm test` dopo T6 | ✅ 74/74 | +3 (`tests/enrichment-job.test.ts`); `jobs.test.ts` verde (backward-compat) |
| `npm run typecheck` dopo T6 | ✅ | clean |
| `npm test` dopo T7 | ✅ 81/81 | +7 (`tests/api-progressive.test.ts`); `api.test.ts` verde |
| `npm run typecheck` dopo T7 | ✅ | clean |
| `npm --prefix web run typecheck` (T8/T9) | ✅ | clean |
| `npm --prefix web run build` (T8/T9) | ✅ | build OK |
| agent-browser walkthrough T8/T9 | ✅ | DB temp isolato (`/tmp`, mai `data/sevedemo.db`); Run per-esecuzione, provenienza, Esporta→lock, freshness-disable verificati |
| `npm test` finale | ✅ 81/81 | suite completa verde |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| Enrichment su singolo contatto e su intero segmento di un bucket | met | per-riga + bulk per bucket (T9, verificato browser) |
| Invoca apimaestro da `linkedin_url`, no cookie | met | `enrichProfileDetails` (T4); **smoke reale confermato 2026-06-15**, 7/21 email recuperate — vedi "Post-implementation — R1" |
| Persistenza refresh (valore nuovo non vuoto vince) | met | `applyProgressiveEnrichment` COALESCE (T2) |
| Opera solo su contatti senza email | met | `enrichSelectionEmails` filtra `withoutEmail` (T5) |
| UI mostra esito aggregato (tentati/recuperate/bozze) | met | pannello esito + toast da `result` del job (T9) |
| Processo asincrono riusabile (`ui_job`) | met | controller `ui_job:enrichment` (T6) |
| Email recuperata → bozza (Sonnet) → "pronto" | met | `draftMany` sui recuperati (T5) |
| Miss → resta "da arricchire", nessuna bozza, nessun errore | met | T5 (test) |
| Tracciamento tentativo (timestamp + actor) | met | `last_enrichment_attempt_at`/`_actor` (T2) |
| Distinzione "tentato senza email" vs "mai tentato" in UI | met | `ToEnrichBadge` (T9, verificato browser) |
| Retry solo quando "stale" (`isFresh`/`FRESHNESS_DAYS`) | met | `isEnrichmentFresh` + gate (T2/T5); bottone disabilitato se fresh (browser) |
| Run page: conteggi pronti/da-arricchire + link alla Selezione | met | `listRunExecutions` + `runs.tsx` (T7/T8, browser) |
| Dalla Selezione raggiungibile il Run (provenienza bidirezionale) | met | link `run_id`→/runs (T9, browser) |
| `daily_selection` registra `run_id` | met | `saveSelection(date,rows,runId)` (T3) |
| Selezione = migliori eleggibili (membership, non `exported`) | met | `selectBucket` esclude i membri di qualsiasi Selezione (T3) |
| Aggiunta manuale dal pool invariata | met | `listCandidates`/AddPanel (T7/T9) |
| Run batch continua a funzionare (remodel additivo) | met | suite esistente verde; `setStatus('selected'/'exported')` rimossi (T3) |
| Eleggibilità & "già contattato" membership-derived | met | T3/T7 |
| `pronto`/`da arricchire` derivati, mai status | met | derivati da email + `last_enrichment_attempt_at` |
| Max una email; `exported` non ri-bersagliati né rientrano in un Run | met | enrich solo `in_review`; `selectBucket` esclude membri di selezioni |

## Out of Scope Observations

- `scripts/seed-demo.ts` è pre-remodel: non scrive `run_id` e imposta status legacy `selected`/`exported`. Non rompe (migrazione idempotente + UI tollerante), ma andrebbe aggiornato al nuovo modello in un chore separato (fuori scope di questa spec).
- Resta il fork storico di "email presente" (`hasEmail` trim vs predicato non-trim) — TD pre-esistente, non unificato qui per scelta della spec.

## Post-implementation — R1 smoke reale (2026-06-15)

Smoke reale di `apimaestro/linkedin-profile-detail` eseguito su un Run vero (selezione
`2026-06-15`, 21 contatti "da arricchire"). Ha confermato l'output annidato **e** scoperto
due difetti, ora corretti (entrambi con APIFY_TOKEN reale):

- **Fix 1 — schema di input (`src/apify/actors.ts`, `profileDetailInput`).** L'actor ignora
  `profileUrl`/`profileUrls`/`urls`: l'unico campo richiesto è **`username`** (che accetta
  anche un URL, incluso il formato URN `/in/ACwAAA…` che salviamo), e **`includeEmail` ha
  default `false`** → va forzato a `true`. Con lo schema vecchio l'actor scrapava il profilo
  demo di default (`sarptecimer`) e non restituiva email. Nuovo input: `{ username: url, includeEmail: true }`.
- **Fix 2 — chiave della mappa (`src/enrich/profile-detail.ts`, `enrichProfileDetails`).**
  L'actor **canonicalizza** l'URL in output (URN → public identifier, es.
  `/in/ACwAAAF1…` → `/in/alessio-maugeri-3322388`), quindi la mappa keyed sull'URL di output
  non combaciava con la lookup del chiamante (`enrichment.get(r.linkedin_url)`, URN) → **tutti**
  i risultati venivano scartati (`emailsRecovered: 0` pur con `attempted: 21`). Ora la chiave è
  l'**URL di input** `u` (chiamiamo un URL per volta). Aggiunto test di regressione in
  `tests/profile-detail.test.ts` con input URN ≠ output canonicalizzato. Questo difetto era
  invisibile ai test perché il campione usava input-url == output-url.

**Esito end-to-end (via `run-enrichment-job.ts`, percorso reale del job):** su 21 target,
**7 email recuperate (33%)** → 7 bozze generate; la Selezione passa da `ready 1` a **`ready 8`**,
`toEnrich 14`; i 14 miss restano "da arricchire" ma con `last_enrichment_attempt_at` timbrato
("tentato, nessuna email"). Suite verde 81/81, typecheck pulito dopo i fix.
