---
domain: _root
type: index
links: []
created: 2026-06-12
updated: 2026-06-12
---

# Brain — Master Map

Entry point of the knowledge base. Links the work areas: chore (informal planning), specs (PM-authored), domains (synthesized by `docs-maintenance`), tech-debt (persistent drift).

## Chore (planning material)

_empty — add planning pages under `chore/` (e.g. tech stack, product description, user stories, implementation backlog)._

## Domains

> Domain pages (`domains/<domain>/<domain>.md` + `<domain>-contract.md` + `concepts/` + `flows/` + `decisions/`) are created by the `docs-maintenance` flow when a spec in that domain is ready to be ingested. Until then a domain appears here only via its spec map.

### lead-engine

Pipeline giornaliera che estrae, arricchisce e seleziona 40 contatti LinkedIn per cold-email (tool #1 di SeVedemo). Pagine migrate da `docs/` il 2026-06-12 (non ancora ingerite in `flows/`/`concepts/`):

- [[domains/lead-engine/lead-engine|lead-engine]] — page map / panoramica del sistema
- [[domains/lead-engine/01-architecture|01 — Architettura]]
- [[domains/lead-engine/02-database|02 — Database]]
- [[domains/lead-engine/03-extraction-strategies|03 — Strategie di estrazione]]
- [[domains/lead-engine/04-enrichment-scoring|04 — Enrichment e scoring]]
- [[domains/lead-engine/05-selection-email-export|05 — Selezione, email, export]]
- [[domains/lead-engine/06-evaluation|06 — Evaluation]]
- [[domains/lead-engine/07-web-ui|07 — Web UI]]

## Specs (per domain)

> Spec map per dominio: [[specs/lead-engine/lead-engine-specs|lead-engine-specs]]

| Domain | Spec | Status |
|--------|------|--------|
| lead-engine | [[specs/lead-engine/ui-pipeline-control/SPEC]] | Implemented |

## Tech debt

_empty_

## Log

- [[log|log.md]] — append-only ingest/spec log (max 50 entries)
