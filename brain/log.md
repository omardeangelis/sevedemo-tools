---
domain: _root
type: index
links: []
created: 2026-06-12
updated: 2026-09-22
---

# Brain — Log

Append-only ingest/spec log. Newest first. Cap at 50 entries; drop the oldest when over.

## [2026-09-22] plan | own-profile-services — PLAN in 5 tappe (T0–T33)
- Plan: [[specs/prospect-crm/own-profile-services/PLAN]] · Spec: [[specs/prospect-crm/own-profile-services/SPEC]] · Flow: [[specs/prospect-crm/own-profile-services/FLOW]]
- Domain: prospect-crm
- `create-plan`: grill con 12 decisioni chiuse (tappe, branch, `PROFILE_MODEL`, freschezza 90gg, impronta spezzata, casella riusata, sito 10 pagine, "Tieni il mio" rinviato, Oggi a due voci, conferma sullo scarto + card rinominata, provenienza dei campi legacy, blocco a zero da rifare); Open Questions della SPEC 1–3 e le 8 del FLOW tutte chiuse
- Tappe: **M1a** invalidazione (T0–T7, l'unica che riscrive righe esistenti) · **M1b** servizi e campi (T8–T12) · **M2** l'analisi nomina il servizio affine (T13–T17) · **M3** Cloudflare quarto strumento (T18–T22) · **M4** generazione e proposta (T23–T33). `sequential`, stop a ogni tappa
- `ux-advisor` sull'ordine: recepito. M1 spezzata in M1a/M1b (non mischiare l'unico momento irreversibile sul DB reale con un rifacimento di pagina); G6/OQ-7 spostati in M4 (prima l'ancora `#genera` non esiste); impronta + tre consumatori FE in un task solo; C7+C15 atomici; backfill senza `NULL`; stima dell'analisi da una funzione sola in M2; documenti nella tappa che li rende falsi (H7 in M1a, H2 in M3, H1 in M4); reset del badge dichiarato in tre posti; smoke di F.6 diviso tra M1a e M2; M3 senza smoke e2e proprio (dichiarato). **Non recepito**: due migrazioni sul DB reale — il kind di M4 entra pre-cablato a stub in M1a, come già fa il repo (`handlers.ts`, `NotImplementedError`), così la migrazione è una sola
- Due decisioni portate all'utente dall'advisor: i tre campi dell'azienda già nel database **non** contano come "scritti a mano" (ma la testata della proposta dichiara quanti ne sostituirebbe), e "zero da rifare" è un **blocco**, non un avviso
- Backlog: 10 story `OP-S1…S10` nel piano, `relation_mode: body-links`, nessun tracker esterno
- Gate `adversarial-verifier` sul piano: **DO NOT SHIP** (2 blocker, 7 major, 13 minor), tutto assorbito in §9b del PLAN. I due blocker: (1) la condizione del marcatore dei post era aritmeticamente impossibile — `truncate` aggiunge i puntini, quindi un estratto troncato è lungo **301** e `length = 300` non corrispondeva a nessun post, marcando integrale ogni post troncato, con la validazione del task costruita sulla stessa premessa; (2) il backfill dell'impronta, unica scrittura su righe esistenti, non era mai provato su una copia del DB reale (T2 gira prima che esista). Major: A6 irraggiungibile perché C12 tiene le fonti isolate e l'attribuzione guarda solo i run falliti (→ P-26); G-11 derogava a E8/H5 senza dichiararlo (→ nuovi **E14** e **H8**); la validazione della stima non era soddisfacibile (prezzo costante nel codice, scritto a mano **tre** volte nella card → `PRICE_ANALYSIS_USD`); B9 senza task che ne costruisse la superficie; il Constraint "scopo dichiarato al servizio" con copertura zero; l'indice di B10 ASCII-only (`QUALITÀ` ≠ `Qualità` con `lower()` di SQLite → colonna `name_key`); il backfill collocato dove avrebbe creato un ciclo di import
- Criteri: 91 → **93** (E14, H8). Copertura verificata: 93/93 mappati a un task, zero riferimenti a criteri inesistenti
- Status: Draft, gate assorbito, pronto per `implement-spec` da T0

## [2026-09-22] spec | own-profile-services — emendamento: una mia modifica non scade un'analisi (F7, F8, F11, F13, H7)
- Spec: [[specs/prospect-crm/own-profile-services/SPEC]] · Flow: [[specs/prospect-crm/own-profile-services/FLOW]]
- Domain: prospect-crm
- Richiesta dell'utente in revisione: *"analisi passate non vanno invalidate dopo che modifico dei punti nel mio ICP, servizi o profilo. Se voglio rifarla la rifaccio"*
- Prima stesura: via `stale` del tutto. **Bocciata dal gate `adversarial-verifier`** (DO NOT SHIP, 4 blocker): l'impronta dell'input copre anche i dati della **persona**, quindi togliere `stale` avrebbe cancellato in silenzio anche l'avviso "questa persona è stata arricchita dopo l'analisi" — non richiesto dall'utente, documentato nel `README.md`, e base della mitigazione di un rischio accettato in `apollo-lookalike` ("lo stato `stale` è già derivato e **visibile**"). Altri blocker: copy del FLOW che prometteva ancora l'invalidazione (conferma di eliminazione di un servizio, invito a rifare l'analisi per un servizio rinominato); F11 resa irraggiungibile da F8; la casella "nuova" dell'anteprima in blocco che esiste già con semantica diversa (`force`)
- Decisione finale dell'utente: **impronta spezzata in due**. `analyses` conserva l'impronta dell'input intero (salto degli identici, F11) e una nuova impronta della **sola persona**, che è l'unica a decidere il badge. Modificare profilo, servizi o ICP non segna niente (F7); un cambio della persona sì, con parole nuove (F13, *"Questa persona è cambiata dopo l'analisi"*). In blocco chi è già analizzato si salta **sempre**, lista o selezione (F8): per includerlo si riusa la casella esistente del dialog, con semantica `onlyMissing` invece di `force`, e l'anteprima distingue "da rifare" da "input identico, saltate comunque"
- Emendamento dichiarato (H7): cambia il **significato** del derivato `stale`, non la sua esistenza. All'ingest: contract del dominio, PLAN di `crm-foundation`, `README.md` (tre motivi → uno), `tests/e2e/README.md`, PLAN di `people-first-crm`. Restano veri e non si toccano: `README.md` sulle scritture Apollo, il Constraints di `apollo-lookalike`, F8 di `people-first-crm`
- Tocca comportamento già rilasciato da `crm-foundation`: non è solo scope della spec nuova
- Criteri: F 10 → 13, H 6 → 7; 91 in tutto (poi 93 col gate sul piano: E14 e H8). Open Questions 1–3 chiuse (freschezza 90 giorni; sito 10 pagine in `CLOUDFLARE_MAX_PAGES`; `PROFILE_MODEL` con default `ANALYSIS_MODEL`); le 8 domande del FLOW chiuse
- Status: Draft, in `create-plan`

## [2026-09-20] spec | Profilo e servizi dell'utente da fonti pubbliche (own-profile-services)
- Created spec: [[specs/prospect-crm/own-profile-services/SPEC]]
- Flow: [[specs/prospect-crm/own-profile-services/FLOW]]
- Domain: prospect-crm
- Fonte: [[chore/roadmap-apollo-icp-assistant-profilo]] §3/§4, marcata come superata; scope ristretto dall'utente in sessione: il profilo è una **sorgente** (niente ricerche Apollo generate, niente ponte verso l'ICP: lo userà l'assistente ICP)
- Contenuto: quattro fonti pubbliche (profilo LinkedIn no-cookie, sito via **Cloudflare Browser Run** come quarto strumento, propri post con testo integrale dai prossimi sync, record d'impresa Apollo per dominio), LLM che produce una **proposta** applicata campo per campo e servizio per servizio con i dati a mano mostrati come conflitti, servizi come righe di `services`, analisi che nomina il **servizio più affine** (condizionato all'esistenza di servizi, così il rilascio non marca da rifare le analisi salvate)
- Emendamenti dichiarati (H1, H2): l'AI esce dall'analisi (D-D della roadmap) e gli strumenti esterni passano da tre a quattro; da riflettere nel contract e nella guida alla radice del repo all'ingest
- Gate `adversarial-verifier` sulla SPEC: DO NOT SHIP ×2 → SHIP al terzo passaggio (BLOCKER assorbiti: arricchimento Apollo solo per dominio, azienda propria fuori da `companies`, emendamenti non dichiarati, garanzia del rilascio legata a un profilo interamente vuoto mentre le istruzioni di output stanno nel system prompt hashato)
- `ux-advisor` → FLOW: confronto della proposta ordinato per decisione con le invariate nascoste, primo giro vs giri successivi, anteprima a quattro fonti con le non disponibili senza checkbox, esito onesto fuori dal log; tre suoi rilievi assorbiti nella SPEC (rilettura forzata di una fonte fresca in D9, applicazione di un servizio modificato in E7, conferma sullo scarto in E12)
- Status: Draft

## [2026-09-20] implement | people-first-crm — tappa M3 completata (T28–T36): spec implementata per intero
- Plan: [[specs/prospect-crm/people-first-crm/PLAN]] · Notes: [[specs/prospect-crm/people-first-crm/IMPLEMENTATION-NOTES]]
- Domain: prospect-crm
- M3 (Connessioni): log di ogni run nel database locale (righe con orario, troncamento al centro oltre 5.000, chiavi mai scritte), strumenti di un run (`toolsOf`/`RUN_TOOLS`) e attribuzione onesta dei fallimenti (`failedTools`), Impostazioni in tre sezioni con **Connessioni** (card per Apify/Apollo/Anthropic con salute che non spaccia per sana una chiave rifiutata), pagina dei run per strumento e dettaglio con parametri leggibili, log in diretta e **Riprova…** dalla preview, avvisi in Oggi sui run falliti e "Dettagli del run" da banner e toast, analisi singola come run staccato (non blocca i job, si rilancia dalla scheda)
- Smoke `tests/e2e/smoke-people.md` (sezione M3, agente separato): 0 BLOCKER, 1 MAJOR, 8 MINOR → tutti corretti e ricontrollati; passaggio `simplify` con 4 revisori sul diff di M3
- Gate: 52 file / 633 test, typecheck, build e typecheck web verdi; avvio provato anche su una **copia** di `data/crm.db` (gli strumenti dei run precedenti si riempiono da soli); nulla committato
- Status: M1, M2, M3 Done — restano `UX-REVIEW.md` (ux-advisor sull'app viva) e, a prodotto fermo, `adversarial-review` in una sessione nuova

## [2026-09-18] implement | people-first-crm — tappa M1 completata (T0–T16), stop in attesa del via per M2
- Plan: [[specs/prospect-crm/people-first-crm/PLAN]] · Notes: [[specs/prospect-crm/people-first-crm/IMPLEMENTATION-NOTES]]
- Domain: prospect-crm
- M1: migrazione unica (provata su una copia di `data/crm.db`: conteggi invariati), persona aggiunta a mano con doppioni, dati a mano che i job non sovrascrivono, LinkedIn facoltativo + Unisci, viste Persone (Tutte · Da smistare · Con prossima azione · Scartate), prossima azione, persona ↔ azienda, sidebar e breadcrumb, onboarding a tre strade, testi A3
- Smoke `tests/e2e/smoke-people.md`: 0 BLOCKER, 2 MAJOR + 18 MINOR → MAJOR e 16 MINOR corretti; 3 MINOR aperti nelle notes
- Gate: 44 file / 579 test, typecheck, build e typecheck web verdi; nulla committato (commit solo col via dell'utente)
- Status: M1 Done · M2, M3 Planned

## [2026-09-18] plan | people-first-crm — PLAN in 3 tappe con stop (37 task, sequential)
- Created plan: [[specs/prospect-crm/people-first-crm/PLAN]]
- Spec: [[specs/prospect-crm/people-first-crm/SPEC]] · Flow: [[specs/prospect-crm/people-first-crm/FLOW]]
- Domain: prospect-crm
- Grill: branch `people-first-crm` da `origin/main` (0967f2f); tappe M1 Persone e contatti manuali (T0–T16) · M2 Seguire le persone (T17–T27) · M3 Connessioni (T28–T36) con stop dopo ognuna; esecuzione sequential; log 5.000 righe per run con inizio e fine; prova della migrazione su una copia temporanea di `data/crm.db` eseguita dall'agente
- ux-advisor sull'ordine: niente Oggi/Cerca in M1, prossima azione gestibile già in M1, "Riprova" dalla preview a inizio M2, M2 a fette verticali, M3 log per primi
- Gate `adversarial-verifier` sul piano: DO NOT SHIP ×3 (MAJOR assorbiti: isolamento di T2 dal DB reale, strumenti dei run creati durante gli stop, layout WAL del DB reale) → SHIP al 4° passaggio; MINOR finale e NIT applicati senza re-gate
- Dopo il gate, su richiesta dell'utente: l'agente ha fermato il server reale (`pnpm ui`, API + Vite, per PID, nessun job in corso) e da ora lo ferma da sé alla ripresa di ogni tappa (§5, T0, T16, T17, T27, T28); anteprima HTML delle tre tappe pubblicata come artifact per la validazione
- Status: Planned

## [2026-09-18] spec | CRM centrato su Persone e Aziende (people-first-crm)
- Created spec: [[specs/prospect-crm/people-first-crm/SPEC]]
- Flow: [[specs/prospect-crm/people-first-crm/FLOW]]
- Domain: prospect-crm
- Scope: navigazione Oggi · Persone · Aziende · Liste · ICP · Impostazioni (Inbox → vista Da smistare), persona aggiunta a mano (nome + un recapito, LinkedIn facoltativo) e collegata all'azienda, Unisci con anteprima, fit manuale per ICP, prossima azione, ricerca globale ⌘K, Impostazioni → Connessioni con run e log per strumento
- Gate `adversarial-verifier`: SPEC v1 DO NOT SHIP (1 BLOCKER identità) → v2 senza BLOCKER (2 MAJOR sulle unioni) → SPEC + FLOW SHIP; MINOR/NIT finali applicati senza re-gate. Cambia l'invariante d'identità del contract (dichiarato in Constraints); chiude TD-38 e il residuo di TD-25
- Status: Draft

## [2026-09-17] spec | apollo-lookalike — domande aperte chiuse con l'utente (spec v3.2, PLAN v2.3)
- Spec: [[specs/prospect-crm/apollo-lookalike/SPEC]] · Flow: [[specs/prospect-crm/apollo-lookalike/FLOW]] · Plan: [[specs/prospect-crm/apollo-lookalike/PLAN]]
- Domain: prospect-crm
- OQ-1 seniority: tutte e 9, nessuna preselezione · OQ-2: nessuna soglia; componente "paese" → "località" città/regione delle referenze, sede assente esclusa con rinormalizzazione · OQ-3: "Trova contatti" dal dettaglio azienda incluso (F12) · OQ-4: pesi costanti, ricerche analizzabili (D14: `score_parts`, `scoring_version`, distribuzione fascia × stato per ricerca)
- Status: Draft, in attesa di review — delta non ri-gated

## [2026-09-16] plan | apollo-lookalike — PLAN in 4 ondate (23 task)
- Created plan: [[specs/prospect-crm/apollo-lookalike/PLAN]]
- Spec: [[specs/prospect-crm/apollo-lookalike/SPEC]] (v3 dopo due gate DO NOT SHIP assorbiti) · Flow: [[specs/prospect-crm/apollo-lookalike/FLOW]]
- Domain: prospect-crm
- Grill: commit + branch `apollo-lookalike`; retry con blocker globale (chiude TD-25); badge "già cercata"; esecuzione parallel a ondate
- Status: Planned — gate: spec v1/v2/v3 DO NOT SHIP (BLOCKER assorbiti), v3.1 senza BLOCKER; piano v2 BLOCKER (grafo) assorbito, v2.1 senza BLOCKER; MAJOR finali corretti in v2.2 senza re-gate

## [2026-09-16] spec | Aziende simili e contatti via Apollo (apollo-lookalike)
- Created spec: [[specs/prospect-crm/apollo-lookalike/SPEC]]
- Flow: [[specs/prospect-crm/apollo-lookalike/FLOW]]
- Domain: prospect-crm
- Status: Draft
- Source: [[chore/roadmap-apollo-icp-assistant-profilo]] §1 + decisioni D-A..D-E; quality gate v1 DO NOT SHIP (1 BLOCKER, 8 MAJOR) assorbito in v2

## [2026-09-16] review | crm-foundation — implementazione del pivot a CRM di prospecting LinkedIn
- Report: [[specs/prospect-crm/crm-foundation/REPORT]] (rubric: [[specs/prospect-crm/crm-foundation/RUBRIC]])
- Scope: spec
- Verdict: DO NOT SHIP
- Impact: critical
- Verifiers: 16 (5 blockers, 11 major)

## [2026-09-16] docs | Reset del brain — rimosso `lead-engine`, creato il dominio `prospect-crm` (crm-foundation T1)
- Source: [[specs/prospect-crm/crm-foundation/PLAN]] (D9, task T1)
- Removed: `domains/lead-engine/` (31 file: page map, 7 pagine narrative, 10 flows, 11 concepts, contract, ADR 0001), `specs/lead-engine/` (27 file: spec map + 7 spec con SPEC/PLAN/IMPLEMENTATION-NOTES, 1 FLOW, 2 RUBRIC/REPORT), `tech-debt/lead-engine/` (3 file). Recuperabili dalla git history (ultimo commit che li contiene: `a6f203b`)
- Added: [[domains/prospect-crm/prospect-crm]] (page map stub, dominio in costruzione) + [[domains/prospect-crm/prospect-crm-contract]] (Owns / Does Not Own / Invariants ripresi da PLAN §3–§6; seam `CompanyLookalikeProvider`/`OutreachProvider` solo documentati)
- Updated: `index.md` (Domains/Specs/Reviews/Tech debt senza lead-engine), [[specs/prospect-crm/prospect-crm-specs]] (`crm-foundation` → In progress)
- Nota: i wikilink verso `lead-engine` nelle voci storiche qui sotto sono intenzionalmente non risolvibili (log append-only, non riscritto)
- Flows/concepts: nessuno scritto a mano — li produrrà `docs-maintenance` all'ingest di `crm-foundation`

## [2026-09-16] plan | Pivot a CRM di prospecting LinkedIn — `crm-foundation` (nuovo dominio `prospect-crm`)
- Created plan: [[specs/prospect-crm/crm-foundation/PLAN]] + flow contract [[specs/prospect-crm/crm-foundation/FLOW]] (ux-advisor) + spec map [[specs/prospect-crm/prospect-crm-specs]]
- Domain: prospect-crm (sostituisce `lead-engine`, la cui rimozione dal brain è il task T1 del piano)
- Decisioni: D1–D12 fissate nel grill con l'owner; nessuna SPEC.md (richiesta di pianificazione esplicita)
- Review: adversarial-verifier 3 passate → SHIP (2026-09-16)
- Status: Planned

## [2026-06-28] ingest | Influencer Post Respondents — fonte primaria azienda-first
- Source: [[specs/lead-engine/influencer-post-respondents/SPEC]]
- Flows written: 3 ([[domains/lead-engine/flows/respondents-azienda-first]], [[domains/lead-engine/flows/gather-primaria-budget-riflusso]], [[domains/lead-engine/flows/selezione-azienda-first]])
- Concepts written: 4 ([[domains/lead-engine/concepts/strategia-influencer-post-respondents]], [[domains/lead-engine/concepts/sotto-fonte-respondents]], [[domains/lead-engine/concepts/espansione-azienda-decisionmaker]], [[domains/lead-engine/concepts/esito-strategia-onesto]])
- Note: flagged CONTRADICTS su [[domains/lead-engine/03-extraction-strategies]] (`freelance-post-reactors` rimossa/sostituita); tagged-person gated-off (tech-debt §1).

## 2026-06-17 — implement-spec + adversarial-review: lead-engine/influencer-post-respondents
- `implement-spec` (sequential, T0–T13 TDD RED→GREEN). Fonte primaria azienda-first:
  commentatori apimaestro + taggati/espansione-azienda, gather primazia+riflusso,
  azienda-first in selezione, report onesto (4 stati + drill-down sotto-fonte).
- `adversarial-review` case B: 6 verifier → 1 BLOCKER (under-fill budget `gather`)
  **risolto** (fase reclaim) e **ri-verificato** (SHIP). Artefatti: RUBRIC.md + REPORT.md.
- Gate finali: suite 131/131, typecheck pulito, web build verde, UI via agent-browser.
- Aperto: T14 (smoke reale, manuale/paid) + tagged-person gated-off (tech-debt).

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
