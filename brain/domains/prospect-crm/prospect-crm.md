---
domain: prospect-crm
type: index
links:
  - "[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]]"
  - "[[specs/prospect-crm/prospect-crm-specs|prospect-crm-specs]]"
  - "[[specs/prospect-crm/crm-foundation/PLAN|crm-foundation PLAN]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW|crm-foundation FLOW]]"
created: 2026-09-16
updated: 2026-09-16
ingested: false
last_ingested: null
---

# Prospect CRM — Domain map

> [!note] Dominio in costruzione
> Il sistema descritto qui **non esiste ancora nel codice**: è in corso l'esecuzione del PLAN
> [[specs/prospect-crm/crm-foundation/PLAN|crm-foundation]]. Finché l'ingest non avviene, la fonte di
> verità è il PLAN (§1–§6, §12) insieme al contratto di flusso
> [[specs/prospect-crm/crm-foundation/FLOW|FLOW.md]]. Le pagine `flows/` e `concepts/` **non** si scrivono
> a mano: le produce `docs-maintenance` quando `crm-foundation` è pronto per l'ingest.

## Cosa fa il dominio

**CRM personale di prospecting LinkedIn** per un unico utente (Omar), locale e single-user. Il modello è
**ICP → liste → prospect → contatto**:

- definire la propria azienda e uno o più **ICP**, con le **aziende di riferimento** che li alimentano;
- generare prospect da chi **reagisce e commenta** i propri post (Sync interazioni → Inbox) e dalle
  **persone di un'azienda** filtrate per i ruoli dell'ICP (Sourcing da azienda → lista);
- organizzare i prospect in **liste per ICP** e gestire il **contatto** (stato globale, timeline di
  touchpoint);
- **arricchire** e far **analizzare dall'AI** i prospect on-demand, sempre con preview dei costi;
- **esportare** una lista in CSV verso il proprio email tool.

Il dominio sostituisce il Lead Engine (`lead-engine`), rimosso dal brain il 2026-09-16 con il pivot: la
conoscenza ancora valida (identità, adapter unico, anti-spesa, best-effort) è ricopiata negli invarianti
del contract. Le pagine legacy restano consultabili solo nella git history (ultimo commit che le contiene:
`a6f203b`).

## Pagine

| Pagina | Contenuto |
|---|---|
| [[domains/prospect-crm/prospect-crm-contract\|prospect-crm-contract]] | Confini del dominio: **Owns / Does Not Own / Invariants**, seam provider futuri |
| `flows/` | _vuoto — scritto da `docs-maintenance` all'ingest di `crm-foundation`_ |
| `concepts/` | _vuoto — scritto da `docs-maintenance` all'ingest di `crm-foundation`_ |
| `decisions/` | _vuoto — le decisioni vivono per ora nel ledger del PLAN (§4, D1–D12 e P1–P10)_ |

## Spec

- Spec map: [[specs/prospect-crm/prospect-crm-specs|prospect-crm-specs]]
- `crm-foundation` — [[specs/prospect-crm/crm-foundation/PLAN|PLAN]] ·
  [[specs/prospect-crm/crm-foundation/FLOW|FLOW]] ·
  [[specs/prospect-crm/crm-foundation/IMPLEMENTATION-NOTES|IMPLEMENTATION-NOTES]] — In progress
