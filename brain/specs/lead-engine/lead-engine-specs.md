---
domain: lead-engine
type: index
links:
  - "[[specs/lead-engine/ui-pipeline-control/SPEC|ui-pipeline-control]]"
  - "[[specs/lead-engine/influencer-post-respondents/SPEC|influencer-post-respondents]]"
created: 2026-06-12
updated: 2026-06-17
---

# Lead Engine — Specs

Mappa delle spec del dominio lead-engine. Entry point per la discovery delle spec.

| Spec | Summary | Status |
|------|---------|--------|
| [[specs/lead-engine/ui-pipeline-control/SPEC\|ui-pipeline-control]] | Lancio del run daily dalla web UI, stato run in corso, notifica di esito in-app, erase completo dei dati per la fase di test | Implemented — vedi IMPLEMENTATION-NOTES |
| [[specs/lead-engine/italy-geo-gate/SPEC\|italy-geo-gate]] | Gate geografico Italia lungo il funnel: scarta i profili fuori dall'Italia il prima possibile (idealmente pre-enrichment), su tutti i bucket, forward-only | Implemented — vedi IMPLEMENTATION-NOTES |
| [[specs/lead-engine/email-draft-guard/SPEC\|email-draft-guard]] | Niente bozza email (Sonnet) per i contatti senza indirizzo: guard di solo costo, contatti senza email restano in selezione/export con campi vuoti | Implemented — vedi IMPLEMENTATION-NOTES |
| [[specs/lead-engine/email-segmentation-filters/SPEC\|email-segmentation-filters]] | Segmentazione per presenza email (Contatti, pool, selezioni, export) + filtri persistenti nell'URL (sessione); selezione automatica invariata | Implemented — vedi IMPLEMENTATION-NOTES |
| [[specs/lead-engine/progressive-enrichment/SPEC\|progressive-enrichment]] | Azione di enrichment progressivo on-demand (actor `apimaestro/linkedin-profile-detail`) per recuperare email mancanti del segmento "da arricchire" → genera bozza → "pronto"; Selezione figlia del Run (seed dal Run, editabile) + stati pronti/da-arricchire visibili su Run e Selezione | Implemented — vedi [[specs/lead-engine/progressive-enrichment/IMPLEMENTATION-NOTES\|IMPLEMENTATION-NOTES]] |
| [[specs/lead-engine/selections-filters-ux/SPEC\|selections-filters-ux]] | UI/UX refresh a invarianza funzionale di Contatti + Selezioni: filtri compatti (barra + chip + "Pulisci") riusati nel pool, sezione Selezioni più respirata e leggibile, aggiunta contatti in modale/sheet guidato con bulk multi-add; componenti condivisi shadcn-style. Vedi [[specs/lead-engine/selections-filters-ux/FLOW\|FLOW]] | Implemented — vedi [[specs/lead-engine/selections-filters-ux/IMPLEMENTATION-NOTES\|IMPLEMENTATION-NOTES]] · review [[specs/lead-engine/selections-filters-ux/REPORT\|SHIP]] |
| [[specs/lead-engine/influencer-post-respondents/SPEC\|influencer-post-respondents]] | `influencers.json` come fonte primaria azienda-first: estrae i **commentatori** dei post (apimaestro) + persone/aziende taggate (aziende espanse a decision-maker), budget dominante + eseguita per prima, priorità bucket azienda; report onesto (0/errore + sotto-fonte). Vedi [[specs/lead-engine/influencer-post-respondents/PLAN\|PLAN]] · review [[specs/lead-engine/influencer-post-respondents/REPORT\|SHIP]] | Implemented — AC1 pending smoke reale (T14), tagged-person gated-off |
