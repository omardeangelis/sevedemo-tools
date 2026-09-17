---
domain: prospect-crm
type: index
links:
  - "[[specs/prospect-crm/crm-foundation/PLAN|crm-foundation PLAN]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW|crm-foundation FLOW]]"
  - "[[specs/prospect-crm/crm-foundation/IMPLEMENTATION-NOTES|crm-foundation IMPLEMENTATION-NOTES]]"
  - "[[domains/prospect-crm/prospect-crm|prospect-crm domain map]]"
  - "[[specs/prospect-crm/apollo-lookalike/SPEC|apollo-lookalike SPEC]]"
  - "[[specs/prospect-crm/apollo-lookalike/PLAN|apollo-lookalike PLAN]]"
created: 2026-09-16
updated: 2026-09-16
---

# Prospect CRM — Specs

Mappa delle spec del dominio `prospect-crm` (CRM personale di prospecting LinkedIn, single-user). Entry
point per la discovery. Il dominio nasce dal pivot del 2026-09-16 che sostituisce il Lead Engine
(`lead-engine`, rimosso dal brain il 2026-09-16 con il task T1 del PLAN `crm-foundation`). Domain map e
contract (in costruzione): [[domains/prospect-crm/prospect-crm|prospect-crm]] ·
[[domains/prospect-crm/prospect-crm-contract|prospect-crm-contract]].

| Spec | Summary | Status |
|------|---------|--------|
| `crm-foundation` — [[specs/prospect-crm/crm-foundation/PLAN\|PLAN]] · [[specs/prospect-crm/crm-foundation/FLOW\|FLOW]] · [[specs/prospect-crm/crm-foundation/IMPLEMENTATION-NOTES\|IMPLEMENTATION-NOTES]] | Pivot completo: purge del Lead Engine, kernel dati ICP → liste → prospect → contatto, sync interazioni dai propri post (reazioni + commenti), sourcing persone da aziende, enrichment e analisi AI on-demand con preview costi, export CSV per lista, web UI ricostruita. **Nessuna SPEC.md**: il PLAN (§1–§6, §12) e il FLOW fanno da contratto; `create-spec` può derivarne una spec formale senza cambiare i task. | In progress (`implement-spec` parallel avviato 2026-09-16; PLAN verificato SHIP da `adversarial-verifier`, 2026-09-16) |
| `apollo-lookalike` — [[specs/prospect-crm/apollo-lookalike/SPEC\|SPEC]] · [[specs/prospect-crm/apollo-lookalike/FLOW\|FLOW]] · [[specs/prospect-crm/apollo-lookalike/PLAN\|PLAN]] | Aziende simili alle referenze via Apollo (filtri derivati deterministici, preview crediti), candidate con triage Accetta/Scarta, contatti nelle aziende accettate verso una lista dell'ICP (0 crediti), email di lavoro via Apollo come secondo provider di arricchimento, pipeline opt-in; identità azienda a doppia chiave `linkedin_url` \| `domain` (D-A). Fonte: [[chore/roadmap-apollo-icp-assistant-profilo\|roadmap]] §1/§6. | Draft, in attesa di review dell'utente (spec v3.2 + FLOW + PLAN v2.3, 2026-09-17: le 4 domande aperte chiuse con l'utente — località città/regione, F12 "Trova contatti" dal dettaglio azienda, D14 ricerche analizzabili — senza re-gate; 4 gate `adversarial-verifier` sulla spec e 2 sul piano fino alla v3.1/v2.2: nessun BLOCKER residuo) |
