---
domain: lead-engine
type: index
links:
  - "[[specs/lead-engine/ui-pipeline-control/SPEC|ui-pipeline-control]]"
created: 2026-06-12
updated: 2026-06-12
---

# Lead Engine — Specs

Mappa delle spec del dominio lead-engine. Entry point per la discovery delle spec.

| Spec | Summary | Status |
|------|---------|--------|
| [[specs/lead-engine/ui-pipeline-control/SPEC\|ui-pipeline-control]] | Lancio del run daily dalla web UI, stato run in corso, notifica di esito in-app, erase completo dei dati per la fase di test | Implemented — vedi IMPLEMENTATION-NOTES |
| [[specs/lead-engine/italy-geo-gate/SPEC\|italy-geo-gate]] | Gate geografico Italia lungo il funnel: scarta i profili fuori dall'Italia il prima possibile (idealmente pre-enrichment), su tutti i bucket, forward-only | Implemented — vedi IMPLEMENTATION-NOTES |
| [[specs/lead-engine/email-draft-guard/SPEC\|email-draft-guard]] | Niente bozza email (Sonnet) per i contatti senza indirizzo: guard di solo costo, contatti senza email restano in selezione/export con campi vuoti | Implemented — vedi IMPLEMENTATION-NOTES |
| [[specs/lead-engine/email-segmentation-filters/SPEC\|email-segmentation-filters]] | Segmentazione per presenza email (Contatti, pool, selezioni, export) + filtri persistenti nell'URL (sessione); selezione automatica invariata | Implemented — vedi IMPLEMENTATION-NOTES |
