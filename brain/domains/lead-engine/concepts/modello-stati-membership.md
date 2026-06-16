---
domain: lead-engine
type: concept
status: implemented
ingested: true
last_ingested: 2026-06-15
links: []
created: 2026-06-15
updated: 2026-06-16
---

# Concetto — Modello degli stati: stadio-dato vs ciclo Selezione (membership-derived)

## Definition

Il remodel separa **due dimensioni** che prima erano conflate in `contacts.status`:

1. **Stadio del dato** — `contacts.status` rappresenta ora **solo** il punto del contatto nella pipeline
   di dati: `new → enriched → scored → discarded → rejected_geo`. I valori `selected`/`exported` sono
   **rimossi dal contatto**: `runDaily` non li scrive più.
2. **Ciclo di vita della Selezione** — `daily_selection.state`: `in_review → exported`. `in_review` è lo
   stato d'ingresso di ogni Selezione (un contatto proposto da un Run è in **revisione**, non "scelto");
   `exported` è assegnato **solo** dall'azione esplicita "Esporta".

Da questa separazione discende che **eleggibilità e "già contattato" sono _derivate dalla membership_**
in `daily_selection`, non dallo status: un Run propone i migliori `scored` **non già presenti in alcuna
Selezione** (`AND id NOT IN (SELECT contact_id FROM daily_selection)`); rimuovere un contatto da una
Selezione lo rende di nuovo eleggibile **automaticamente**; "max una email" = non riproporre chi è in una
Selezione `exported`. Allo stesso modo **`pronto` / `da arricchire` restano _derivati_** — presenza email
([[presenza-email|predicato canonico]]) + `last_enrichment_attempt_at` — e **mai promossi a `status`**.

> [!note] Pagine di panoramica riallineate (2026-06-16)
> Le pagine narrative [[01-architecture]], [[02-database]], [[05-selection-email-export]] e l'indice
> [[lead-engine]] descrivevano il vecchio ciclo `… → selected → exported` **sul contatto**; il
> de-staling del 2026-06-16 le ha riallineate a questo modello. Questo concept resta il riferimento
> canonico: dove panoramica (01–07) e flow/concept divergessero, **vince il concept**.

## Attributes

| Attributo | Valore |
|-----------|--------|
| `contacts.status` (stadio-dato) | `new \| enriched \| scored \| discarded \| rejected_geo` (`src/db/index.ts`) |
| Rimosso dal contatto | `selected`, `exported` (non più scritti da `runDaily`) |
| `daily_selection.state` (ciclo) | `in_review` (default all'INSERT) → `exported` (solo da "Esporta") |
| Eleggibilità a un Run | `scored` ∧ `fit_score ≥ minFit` ∧ **`NOT IN (SELECT contact_id FROM daily_selection)`** (`selectBucket`) |
| "Già contattato" | membership in una Selezione `exported` — non uno status del contatto |
| Rimozione da Selezione | il contatto torna eleggibile **automaticamente** (nessuno status orfano da sincronizzare) |
| `pronto` (derivato) | presenza email ([[presenza-email]]), mai `status` |
| `da arricchire` (derivato) | senza email; sotto-distinzione via `last_enrichment_attempt_at` |
| "tentato senza email" vs "mai tentato" | `last_enrichment_attempt_at` valorizzato vs `null` → badge `ToEnrichBadge` (UI) |
| Migrazione | additiva via `ensureColumn`; **remap legacy one-shot** alla prima comparsa di `daily_selection.state`, idempotente per ordine delle UPDATE (una `exported` nuova non regredisce) |

## Related flows

- [[selezione-figlia-del-run]] — il ciclo `in_review → exported` e l'eleggibilità membership-derived in
  azione (generazione, provenienza, export).
- [[enrichment-progressivo-email]] — usa lo stamp `last_enrichment_attempt_at` per la distinzione
  "tentato/mai tentato" e per il gate di freshness.

## [Source: SPEC + IMPLEMENTATION-NOTES progressive-enrichment]

- **Decisione (utente, fase di plan):** `status` confondeva stadio-dato e ciclo cold-email — da qui
  `selected` come stato d'ingresso (errato) e il bug del contatto rimosso da una Selezione lasciato
  `selected` orfano. Separando le due dimensioni, "una Selezione è l'export validato di un Run" diventa il
  modello dei dati e il disallineamento status↔membership sparisce per costruzione.
- **`pronto`/`da arricchire` = derivati, mai `status`:** ciò che è funzione del dato non va congelato in
  una colonna (eviterebbe la sincronizzazione); coerente con
  [[specs/lead-engine/email-segmentation-filters/SPEC|email-segmentation-filters]].
- **T1/T2/T3:** schema + `migrate()` (`tests/migration.test.ts`), campi `last_enrichment_attempt_at`/
  `_actor` su `ContactRow` (T2), `selectBucket`/`saveSelection` con membership e `state` (T3). I due
  campi nuovi hanno richiesto un fix alle factory di `email-draft-guard.test.ts` / `italy-geo-gate.test.ts`
  (typecheck, non comportamento).
- **Tech-debt:** `scripts/seed-demo.ts` resta pre-remodel (status legacy `selected`/`exported`, no
  `run_id`) — vedi [[tech-debt/lead-engine/progressive-enrichment|tech-debt/progressive-enrichment]] TD-1.
