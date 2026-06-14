---
domain: lead-engine
type: concept
status: implemented
ingested: true
last_ingested: 2026-06-14
links: []
created: 2026-06-14
updated: 2026-06-14
---

# Concetto — Stato `rejected_geo` (tombstone geografico)

## Definition

`rejected_geo` è il **nuovo status terminale** assegnato a un contatto scartato dal
[[gate-geografico-italia|gate geografico Italia]] perché la sua località non è riconducibile
all'Italia (vedi [[classificazione-geografica]]). È un **tombstone**: marca il profilo come "valutato e
scartato per geografia" così non viene né selezionato/esportato, né ri-processato (ri-pagato) nei run
futuri.

Non è un cambio di schema: la colonna `contacts.status` è `TEXT` libera (valori noti
`new|enriched|scored|selected|exported`); `rejected_geo` è semplicemente un **nuovo valore**. Viene
scritto da `markRejectedGeo(id)` (`src/db/contacts.ts`), che esegue
`UPDATE contacts SET status='rejected_geo', last_evaluated_at=nowIso() WHERE id=?`.

Lo **stamp di `last_evaluated_at` è la parte essenziale**, non un dettaglio: è ciò che lega il tombstone
al meccanismo di freshness esistente. `isFresh(id, FRESHNESS_DAYS)` diventa `true`, quindi in `persist`
il ramo `!isFresh(id)` è falso e il profilo **non** rientra in `toProcess` → niente ri-enrichment, niente
ri-pagamento Apify ad ogni run (risolve OQ#3). Senza lo stamp, un profilo scartato resterebbe con
`last_evaluated_at = NULL` e verrebbe ri-arricchito ogni giorno.

## Attributes

| Attributo | Valore |
|-----------|--------|
| Valore status | `rejected_geo` (nuovo valore di `contacts.status`, colonna `TEXT`; **nessuna migrazione**) |
| Scritto da | `markRejectedGeo(id)` (`src/db/contacts.ts`) — idempotente; no-op su id inesistente |
| Effetto collaterale | stampa `last_evaluated_at = nowIso()` → interazione con la freshness |
| Invariante freshness | dopo il tombstone `isFresh(id, FRESHNESS_DAYS)` è `true` → `persist` salta il profilo nei run futuri (OQ#3) |
| Visibilità — selezione | **assente**: `selectBucket` richiede `status='scored'`; un `rejected_geo` non raggiunge mai `scored` (AC#4) |
| Visibilità — export | **assente**: `runDaily` esporta dalla selezione; `runStrategy` esporta il valore di ritorno `gated` di `enrichAndScore` (fix anti-leak) |
| Visibilità — pool UI | **assente** da `/api/selections/:date/candidates` (`listCandidates` richiede `status IN ('scored','selected','exported')`) |
| Visibilità — Contatti | **presente** come status osservabile (`searchContacts` elenca tutti gli status); mai come `selected`/`exported` |
| Osservabilità run | conteggio loggato per gate: `→ geo-gate (pre\|post): scartati N profili fuori Italia` (AC#5) |
| Ambito temporale | **forward-only**: marca solo i profili processati d'ora in poi; nessun cleanup dei non-italiani già in DB (Non-Goal) |
| UI dedicata | nessuna in questa spec (filtri per `rejected_geo` sono Non-Goal — altra spec) |

## Related flows

- [[gate-geografico-italia]] — il flow che produce i tombstone (pre e post enrichment) e
  garantisce l'esclusione da selezione/export/pool.
- [[03-extraction-strategies]] — la freshness/cursore (`last_evaluated_at`, `FRESHNESS_DAYS`) su cui il
  tombstone si appoggia per non ri-pagare i profili scartati.
- [[01-architecture]] — il ciclo di vita degli status `new → enriched → scored → selected → exported`, di
  cui `rejected_geo` è una diramazione terminale.

## [Source: SPEC + IMPLEMENTATION-NOTES italy-geo-gate]

- **Tombstone vs scarto senza traccia (OQ#3 → D3):** scelto il tombstone `rejected_geo` + stamp
  `last_evaluated_at` per riusare la freshness esistente ed evitare il ri-enrichment ricorrente.
- **Osservabilità (D4):** log console per run, conteggi separati pre/post; nessun cambio alla tabella
  `runs` (no schema change).
- **Fix critico anti-leak:** il return di `enrichAndScore` usa `gated` (non `rows`), altrimenti i tombstone
  rientravano nell'export di `runStrategy` (AC#1/AC#4). `runDaily` interroga il DB direttamente (già
  ripulito), quindi non era affetto.
- **Verifica DB:** `markRejectedGeo` testato (status → `rejected_geo`, `last_evaluated_at` valorizzato,
  `isFresh` → `true`, idempotenza, no-op su id inesistente) in `tests/italy-geo-gate.test.ts`.
