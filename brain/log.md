---
domain: _root
type: index
links: []
created: 2026-06-12
updated: 2026-06-12
---

# Brain — Log

Append-only ingest/spec log. Newest first. Cap at 50 entries; drop the oldest when over.

<!-- Entries are appended by create-spec (spec creation) and docs-maintenance (ingest). Format:

## [YYYY-MM-DD] ingest | <spec title>
- Source: [[specs/<domain>/<spec>/SPEC]]
- Flows written: <count>
- Concepts written: <count>
-->

## [2026-06-16] review | UX dei filtri e redesign della sezione Selezioni (spec implementation)
- Report: [[specs/lead-engine/selections-filters-ux/REPORT]]
- Scope: spec
- Verdict: SHIP
- Impact: critical
- Verifiers: 5 (0 blockers, 1 major found-and-fixed in-session: `emailReady` URL hygiene)

## [2026-06-16] spec | UX dei filtri e redesign della sezione Selezioni
- Created spec: [[specs/lead-engine/selections-filters-ux/SPEC]]
- Flow: [[specs/lead-engine/selections-filters-ux/FLOW]]
- Domain: lead-engine
- Status: Draft

## [2026-06-16] docs | lead-engine — contract, ADR 0001 (provider seam), de-staling remodel
- Added: [[domains/lead-engine/lead-engine-contract]], [[domains/lead-engine/decisions/0001-confini-dominio-provider-seam]]
- De-staled al modello post-remodel: [[domains/lead-engine/01-architecture]], [[domains/lead-engine/02-database]], [[domains/lead-engine/05-selection-email-export]], [[domains/lead-engine/07-web-ui]], [[domains/lead-engine/lead-engine]] (page map)
- Decisione: un solo dominio lead-engine, seam-aware; graduazione capability→dominio quando il provider seam si indurisce

## [2026-06-15] ingest | Enrichment progressivo — recupero email mancanti e Selezione figlia del Run
- Source: [[specs/lead-engine/progressive-enrichment/SPEC]]
- Flows written: 2 ([[domains/lead-engine/flows/enrichment-progressivo-email]], [[domains/lead-engine/flows/selezione-figlia-del-run]])
- Concepts written: 3 ([[domains/lead-engine/concepts/modello-stati-membership]], [[domains/lead-engine/concepts/run-come-esecuzione]], [[domains/lead-engine/concepts/enrichment-progressivo-apimaestro]])

## [2026-06-14] spec | Enrichment progressivo — recupero email mancanti e Selezione figlia del Run
- Created spec: [[specs/lead-engine/progressive-enrichment/SPEC]]
- Domain: lead-engine
- Status: Draft

## [2026-06-14] ingest | Gate geografico Italia sull'estrazione
- Source: [[specs/lead-engine/italy-geo-gate/SPEC]]
- Flows written: 1 ([[domains/lead-engine/flows/gate-geografico-italia]])
- Concepts written: 2 ([[domains/lead-engine/concepts/classificazione-geografica]], [[domains/lead-engine/concepts/stato-rejected-geo]])

## [2026-06-14] ingest | Segmentazione per presenza email e filtri persistenti
- Source: [[specs/lead-engine/email-segmentation-filters/SPEC]]
- Flows written: 3 ([[domains/lead-engine/flows/segmentazione-presenza-email]], [[domains/lead-engine/flows/filtri-persistenti-url]], [[domains/lead-engine/flows/export-email-ready]])
- Concepts written: 2 (nuovo [[domains/lead-engine/concepts/stato-filtri-url]] + merge in [[domains/lead-engine/concepts/presenza-email]])

## [2026-06-13] ingest | Niente bozza email senza indirizzo
- Source: [[specs/lead-engine/email-draft-guard/SPEC]]
- Flows written: 1 ([[domains/lead-engine/flows/bozze-email-guard]])
- Concepts written: 1 ([[domains/lead-engine/concepts/presenza-email]])

## [2026-06-13] spec | Segmentazione per presenza email e filtri persistenti
- Created spec: [[specs/lead-engine/email-segmentation-filters/SPEC]]
- Domain: lead-engine
- Status: Draft

## [2026-06-13] spec | Niente bozza email senza indirizzo
- Created spec: [[specs/lead-engine/email-draft-guard/SPEC]]
- Domain: lead-engine
- Status: Draft

## [2026-06-13] spec | Gate geografico Italia sull'estrazione
- Created spec: [[specs/lead-engine/italy-geo-gate/SPEC]]
- Domain: lead-engine
- Status: Draft

## [2026-06-12] spec | Controllo pipeline dalla web UI — lancio run, stato ed erase dati
- Created spec: [[specs/lead-engine/ui-pipeline-control/SPEC]]
- Domain: lead-engine
- Status: Draft

## [2026-06-12] migration | docs/ → brain/domains/lead-engine/
- Source: legacy `docs/` (8 markdown files, mossi con `git mv`)
- Pages: [[domains/lead-engine/lead-engine|lead-engine]] (page map) + 7 pagine numerate (01–07)
- Frontmatter aggiunto a tutte le pagine; `ingested: false` in attesa di `docs-maintenance`
- Link repointati: `README.md` → brain; `lead-engine.md` → README principale
