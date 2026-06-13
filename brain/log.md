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
