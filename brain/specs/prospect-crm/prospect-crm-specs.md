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
  - "[[specs/prospect-crm/people-first-crm/SPEC|people-first-crm SPEC]]"
  - "[[specs/prospect-crm/people-first-crm/FLOW|people-first-crm FLOW]]"
  - "[[specs/prospect-crm/people-first-crm/PLAN|people-first-crm PLAN]]"
  - "[[specs/prospect-crm/own-profile-services/SPEC|own-profile-services SPEC]]"
  - "[[specs/prospect-crm/own-profile-services/FLOW|own-profile-services FLOW]]"
  - "[[specs/prospect-crm/own-profile-services/PLAN|own-profile-services PLAN]]"
created: 2026-09-16
updated: 2026-09-22
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
| `apollo-lookalike` — [[specs/prospect-crm/apollo-lookalike/SPEC\|SPEC]] · [[specs/prospect-crm/apollo-lookalike/FLOW\|FLOW]] · [[specs/prospect-crm/apollo-lookalike/PLAN\|PLAN]] | Aziende simili alle referenze via Apollo (filtri derivati deterministici, preview crediti), candidate con triage Accetta/Scarta, contatti nelle aziende accettate verso una lista dell'ICP (ricerca gratuita + match per id a 1 credito, S-6), candidate arricchite nella ricerca (S-7), email di lavoro via Apollo come secondo provider di arricchimento, pipeline opt-in; identità azienda a doppia chiave `linkedin_url` \| `domain` (D-A). Fonte: [[chore/roadmap-apollo-icp-assistant-profilo\|roadmap]] §1/§6. | Implementata 2026-09-17 (`implement-spec` parallel, 23/23 task, [[specs/prospect-crm/apollo-lookalike/IMPLEMENTATION-NOTES\|note]], smoke T18 senza BLOCKER); `$simplify`, audit dei criteri e fix degli unmet fatti (72/72 met: D12 e I2 emendando la SPEC, C5/C7/F10/G3 con codice e test, chiusi anche AL-TD-4 e AL-TD-7); da fare: `ux-advisor` rinviato dall'utente, poi `adversarial-review` in nuova sessione |
| `people-first-crm` — [[specs/prospect-crm/people-first-crm/SPEC\|SPEC]] · [[specs/prospect-crm/people-first-crm/FLOW\|FLOW]] · [[specs/prospect-crm/people-first-crm/PLAN\|PLAN]] | CRM centrato su Persone e Aziende: navigazione Oggi · Contatti (Persone, Aziende) · Prospecting (Liste, ICP) · Impostazioni, con l'Inbox che diventa la vista Da smistare; persona aggiunta a mano (nome + un recapito, LinkedIn facoltativo) collegabile a un'azienda, Unisci con anteprima; dati impostati a mano che i job non riscrivono; fit manuale per ICP sopra quello AI; prossima azione per persona; home Oggi; ricerca globale ⌘K; Impostazioni → Connessioni con run e log per strumento. Cambia l'invariante d'identità (email non chiave). | Planned (2026-09-18: SPEC + FLOW SHIP; PLAN in 3 tappe M1 → M2 → M3 con stop, SHIP al gate `adversarial-verifier`) |
| `own-profile-services` — [[specs/prospect-crm/own-profile-services/SPEC\|SPEC]] · [[specs/prospect-crm/own-profile-services/FLOW\|FLOW]] · [[specs/prospect-crm/own-profile-services/PLAN\|PLAN]] | Profilo e servizi dell'utente generati dalle sue superfici pubbliche: profilo LinkedIn (actor no-cookie), sito (Cloudflare Browser Run, quarto strumento), propri post con testo integrale dai prossimi sync, record d'impresa Apollo per dominio. L'LLM produce una **proposta** che l'utente applica campo per campo e servizio per servizio, con i dati scritti a mano mostrati come conflitti; i servizi diventano righe di `services` e l'analisi nomina il **servizio più affine** a una persona. Emenda tre invarianti: l'AI esce dall'analisi (D-D), gli strumenti passano da tre a quattro e **cambia il significato di `stale`** — l'impronta si spezza in due: modificare profilo, servizi o ICP non segna più le analisi salvate né le rimette tra i bersagli di una rianalisi, mentre un cambio della **persona** resta segnalato; in blocco chi è già analizzato si salta sempre, salvo casella esplicita. Nessun ponte verso l'ICP: lo userà l'assistente ICP. Fonte: [[chore/roadmap-apollo-icp-assistant-profilo\|roadmap]] §3/§4. | Draft (2026-09-22: emendamento sull'invalidazione — prima stesura bocciata dal gate, poi impronta spezzata in due: F7/F8/F11/F13 e H7; Open Questions e domande del FLOW tutte chiuse; PLAN in **5 tappe** con stop (M1a invalidazione · M1b servizi e campi · M2 l'analisi nomina il servizio affine · M3 Cloudflare · M4 generazione e proposta), 34 task `sequential` su branch `own-profile-services` da `people-first-crm`, `ux-advisor` sull'ordine recepito; gate `adversarial-verifier` sul piano DO NOT SHIP, assorbito in §9b (2 blocker: il marcatore dei post era aritmeticamente impossibile, il backfill non era provato sul DB reale) — 93 criteri, copertura 93/93. 2026-09-20: SPEC SHIP al terzo passaggio del gate `adversarial-verifier`, FLOW con `ux-advisor`) |
