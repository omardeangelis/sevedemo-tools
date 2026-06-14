---
domain: _root
type: index
links: []
created: 2026-06-12
updated: 2026-06-14
---

# Brain — Master Map

Entry point of the knowledge base. Links the work areas: chore (informal planning), specs (PM-authored), domains (synthesized by `docs-maintenance`), tech-debt (persistent drift).

## Chore (planning material)

_empty — add planning pages under `chore/` (e.g. tech stack, product description, user stories, implementation backlog)._

## Domains

> Domain pages (`domains/<domain>/<domain>.md` + `<domain>-contract.md` + `concepts/` + `flows/` + `decisions/`) are created by the `docs-maintenance` flow when a spec in that domain is ready to be ingested. Until then a domain appears here only via its spec map.

### lead-engine

Pipeline giornaliera che estrae, arricchisce e seleziona 40 contatti LinkedIn per cold-email (tool #1 di SeVedemo). Pagine narrative migrate da `docs/` il 2026-06-12; l'ingest spec-driven in `flows/`/`concepts/` è in corso (5 flows, 4 concepts).

- [[domains/lead-engine/lead-engine|lead-engine]] — page map / panoramica del sistema
- [[domains/lead-engine/01-architecture|01 — Architettura]]
- [[domains/lead-engine/02-database|02 — Database]]
- [[domains/lead-engine/03-extraction-strategies|03 — Strategie di estrazione]]
- [[domains/lead-engine/04-enrichment-scoring|04 — Enrichment e scoring]]
- [[domains/lead-engine/05-selection-email-export|05 — Selezione, email, export]]
- [[domains/lead-engine/06-evaluation|06 — Evaluation]]
- [[domains/lead-engine/07-web-ui|07 — Web UI]]
- Flows: [[domains/lead-engine/flows/bozze-email-guard|bozze-email-guard]] · [[domains/lead-engine/flows/segmentazione-presenza-email|segmentazione-presenza-email]] · [[domains/lead-engine/flows/filtri-persistenti-url|filtri-persistenti-url]] · [[domains/lead-engine/flows/export-email-ready|export-email-ready]] · [[domains/lead-engine/flows/gate-geografico-italia|gate-geografico-italia]]
- Concepts: [[domains/lead-engine/concepts/presenza-email|presenza-email]] · [[domains/lead-engine/concepts/stato-filtri-url|stato-filtri-url]] · [[domains/lead-engine/concepts/classificazione-geografica|classificazione-geografica]] · [[domains/lead-engine/concepts/stato-rejected-geo|stato-rejected-geo]]

## Specs (per domain)

> Spec map per dominio: [[specs/lead-engine/lead-engine-specs|lead-engine-specs]]

| Domain | Spec | Status |
|--------|------|--------|
| lead-engine | [[specs/lead-engine/ui-pipeline-control/SPEC]] | Implemented |
| lead-engine | [[specs/lead-engine/italy-geo-gate/SPEC]] | Implemented |
| lead-engine | [[specs/lead-engine/email-draft-guard/SPEC]] | Implemented |
| lead-engine | [[specs/lead-engine/email-segmentation-filters/SPEC]] | Implemented |

## Tech debt

| Domain | Spec | Voci aperte |
|--------|------|-------------|
| lead-engine | [[tech-debt/lead-engine/email-segmentation-filters\|email-segmentation-filters]] | TD-1 fork dei 3 predicati "email presente"; TD-2 plumbing `sector`/`minFit` |

## Log

- [[log|log.md]] — append-only ingest/spec log (max 50 entries)
