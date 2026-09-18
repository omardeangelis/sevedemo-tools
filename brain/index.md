---
domain: _root
type: index
links: []
created: 2026-06-12
updated: 2026-09-16
---

# Brain — Master Map

Entry point of the knowledge base. Links the work areas: chore (informal planning), specs (PM-authored), domains (synthesized by `docs-maintenance`), tech-debt (persistent drift).

## Chore (planning material)

- [[chore/roadmap-apollo-icp-assistant-profilo|Roadmap Apollo · assistente ICP · anagrafica]] — piani preliminari delle tre capability richieste il 2026-09-16 e decisioni D-A..D-E; ogni sezione diventa una spec (`apollo-lookalike` creata).

## Domains

> Domain pages (`domains/<domain>/<domain>.md` + `<domain>-contract.md` + `concepts/` + `flows/` + `decisions/`) are created by the `docs-maintenance` flow when a spec in that domain is ready to be ingested. Until then a domain appears here only via its spec map.

### prospect-crm

CRM personale di prospecting LinkedIn (single-user): ICP → liste → prospect → contatto, sync interazioni dai propri post, sourcing persone da aziende, enrichment e analisi AI on-demand, export CSV. **In costruzione** (PLAN `crm-foundation` in esecuzione); sostituisce `lead-engine`, rimosso dal brain il 2026-09-16.

- [[domains/prospect-crm/prospect-crm|prospect-crm]] — page map (stub: dominio in costruzione, vedi PLAN/FLOW)
- Contract: [[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]] — Owns / Does Not Own / Invariants, seam `CompanyLookalikeProvider` e `OutreachProvider` (solo documentati)
- Flows / Concepts / Decisions: _nessuna pagina ancora — le scrive `docs-maintenance` all'ingest di `crm-foundation`_

## Specs (per domain)

> Spec map per dominio: [[specs/prospect-crm/prospect-crm-specs|prospect-crm-specs]]

| Domain | Spec | Status |
|--------|------|--------|
| prospect-crm | `crm-foundation` — [[specs/prospect-crm/crm-foundation/PLAN\|PLAN]] · [[specs/prospect-crm/crm-foundation/FLOW\|FLOW]] · [[specs/prospect-crm/crm-foundation/IMPLEMENTATION-NOTES\|IMPLEMENTATION-NOTES]] (nessuna SPEC.md: il PLAN fa da contratto) | In progress — `implement-spec` parallel avviato 2026-09-16 (PLAN verificato SHIP) |
| prospect-crm | `apollo-lookalike` — [[specs/prospect-crm/apollo-lookalike/SPEC\|SPEC]] · [[specs/prospect-crm/apollo-lookalike/FLOW\|FLOW]] · [[specs/prospect-crm/apollo-lookalike/PLAN\|PLAN]] | Draft — spec v3.2 + FLOW + PLAN v2.3, 2026-09-17 (arricchimento referenze → aziende simili → triage → contatti in lista → email di lavoro; identità azienda a doppia chiave; 23 task in 4 ondate; domande aperte chiuse) |

> Le 7 spec `lead-engine` (tutte Implemented) sono state rimosse col pivot del 2026-09-16: restano nella git history.

## Reviews

> `adversarial-review` verdicts. Case B reviews live in the spec folder; case A under `review/<slug>/`.

- [[specs/prospect-crm/crm-foundation/REPORT|prospect-crm/crm-foundation]] — spec · do-not-ship · critical · 2026-09-16

## Tech debt

- [[tech-debt/prospect-crm/crm-foundation|crm-foundation]] — 22 voci MINOR (attriti, copy, accessibilità, decisioni aperte) dallo smoke end-to-end del PLAN `crm-foundation`; nessun BLOCKER/MAJOR.

## Log

- [[log|log.md]] — append-only ingest/spec log (max 50 entries)
