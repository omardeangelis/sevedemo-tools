---
domain: prospect-crm
type: implementation-notes
spec: apollo-lookalike
links:
  - "[[specs/prospect-crm/apollo-lookalike/SPEC]]"
  - "[[specs/prospect-crm/apollo-lookalike/PLAN]]"
  - "[[specs/prospect-crm/apollo-lookalike/FLOW]]"
  - "[[tech-debt/prospect-crm/apollo-lookalike]]"
ingested: false
last_ingested: null
created: 2026-09-17
updated: 2026-09-17
---

# Implementation Notes — `apollo-lookalike`

## Summary

- Run `implement-spec` del 2026-09-17: **23/23 task del PLAN completati** (T0–T18), su branch `apollo-lookalike`
  sopra il commit di base `7a33339` (stato di crm-foundation, solo locale). Nessun commit dei cambiamenti di
  questa spec: il working tree è da rivedere e committare.
- Consegnato: configurazione e readiness Apollo, smoke reale manuale (`npm run apollo:smoke`), identità azienda a
  doppia chiave con migrazione e backup, arricchimento Apollo delle aziende, ricerca di aziende simili con
  arricchimento delle candidate e punteggio v1, storico ricerche analizzabile, triage delle candidate, "Trova
  contatti" (ricerca + match per id) anche dal dettaglio azienda, email di lavoro via Apollo come secondo
  provider, pipeline opt-in, "Riprova" con i blocker di configurazione per tutti i job, fake e2e con scenari
  d'errore, UI di pagina ICP / Aziende / arricchimento, README e AGENTS.
- Due decisioni di prodotto prese durante il run sui fatti di Apollo (S-6, S-7) e registrate in SPEC, FLOW e
  PLAN; per scelta dell'utente **non** eseguiti in questa sessione `$simplify`, audit dei criteri di
  accettazione e walkthrough `ux-advisor` (vedi Steering e Remaining Work).

## Execution Mode

- `parallel` a ondate (decisione G-4 del PLAN). L'orchestratore esegue direttamente la base git di T0 e
  delega ogni task a un worker `general-purpose` nello stesso working tree, con scope di file disgiunti
  secondo la mappa proprietari del PLAN §8. Nessun `.agents/subagents/manifest.mjs` nel repo: i worker
  usano il tipo generico. Nessun advisor schema/dati definito nel progetto: il trigger pre-task dei task
  data-layer (T4a, T5) è saltato per assenza dell'advisor, non per scelta.
- Ondate effettive: B = T0 (script smoke) ∥ T1 · C = T2 ∥ T3 · D = T4a (+ smoke reale dell'utente e follow-up di
  T0/T2/T3) · E = T5 · F = T4b ∥ T7a ∥ T7c ∥ T8 ∥ T10 ∥ T11 · G = T7b ∥ T6 ∥ T12a, poi T9 (server) in parallelo a
  T12a · H = T16 ∥ fix AL-TD-5 · T12 · T13 ∥ T14 · T15 ∥ T17 · T18.
- I worker non aggiornano `PLAN.md`/`IMPLEMENTATION-NOTES.md` (evita scritture concorrenti sullo stesso file):
  l'orchestratore scrive stato, log e file toccati dai loro report dopo la revisione.

## Deviations From the Plan

- **S-6 (steering 2026-09-17) — contatti a pagamento.** La documentazione Apollo (docs.apollo.io, verificata
  il 2026-09-17) e poi lo smoke reale: la People API Search restituisce id, nome, cognome offuscato e titolo
  **senza URL LinkedIn né dominio**; con il piano originale (0 crediti, prospect solo da persone con URL) F
  avrebbe prodotto 0 prospect. Decisione dell'utente: le aziende si scelgono col triage, poi "Trova contatti" fa
  ricerca gratuita + `people/bulk_match` per id (1 credito a persona trovata, dichiarato in preview come
  tetto), salvando anche l'email di lavoro. Aggiornati SPEC (A5, F2, F4, F5, F10, H1, Constraints, Technical
  Notes, Decision Log), FLOW (C.2, C.3, E.2) e PLAN (§4 S-6).
- **S-7 (steering 2026-09-17, dopo lo smoke reale) — arricchimento delle candidate.** La ricerca aziende
  restituisce 0/5 su settore, parole chiave, dipendenti e sede: il punteggio sarebbe sempre 0. Decisione
  dell'utente: il job di ricerca arricchisce le aziende nuove non già arricchite (1 credito ciascuna) e il dialog
  offre 25 · 50 · 100 aziende per pagina (default 25). Aggiornati SPEC (D2, D3, D6, D9, D11, H1, Decision Log),
  FLOW (A.2, A.3) e PLAN (§4 S-7, §7 esiti smoke).
- **Rate limit reali** molto più bassi dell'assunto (20/min, 100/h, 600/24h su arricchimento e match; 50/min,
  200/h, 600/24h sulle ricerche): default `APOLLO_RATE_LIMIT_PER_MINUTE` 200 → 20 (RED→GREEN in
  `api-settings`), client con ritmo per endpoint dagli header `x-*-requests-left` (T3 follow-up).
- **Contratto API**: diverse forme reali sono più ricche o diverse da PLAN §12 (es. `origins` annidato per tipo
  di filtro, `custom=1` con parametri ripetuti, `perPage`, `resume`, `references[].status`, conteggi superset,
  `from-url` trova-o-crea senza 409): consolidate in PLAN **§12-bis**, che prevale.
- **P-18 invariata** (collisioni di dominio in migrazione solo nel log): AL-TD-3.
- **Fuori dalla mappa §8, motivati**: guard `config:` su URL nullo in `source-company.ts` (T4a); fix di sola
  compilazione nelle pagine aziende/ICP/prospect (T12); `apollo_matched_at` nelle righe delle tabelle prospect
  (T14); `addSource({refreshCapturedAt})` per "già cercata il <data>" (T8); costante unica `APOLLO_KEY_BLOCKER`
  in `src/config.ts`; copy del form referenze della pagina ICP ("URL LinkedIn o sito web", SPEC B13) corretto
  dall'orchestratore dopo T17.

## Surprises and Decisions

- **Gate di base (T0)**: `typecheck`, build e typecheck web verdi; `vitest` 4 test falliti in
  `tests/analyze.test.ts` perché `ANALYSIS_MODEL` del `.env` locale trapelava nei test. Corretto in T1:
  `tests/setup.ts` non legge più il `.env` (`DOTENV_CONFIG_PATH=os.devNull`) e fissa i parametri di config.
- **Fixture sovrascritte dallo smoke**: le copie anonimizzate del primo smoke reale hanno sovrascritto le
  fixture docs non ancora committate (7 test rotti). Ripristinate; le copie reali ora stanno in
  `tests/fixtures/apollo/smoke/` con indirizzi e headline mascherati (TD-29: repo pubblico) e lo script non
  scrive più sulle fixture docs.
- **`bulk_match` può ripetere la stessa persona** e contiene `null` per i non trovati: gli handler allineano i
  risultati per posizione (T8, T10), non con la deduplica di `mapPeople`.
- **Migrazione unica** (T5): `migrateSchema` ricostruisce `companies`, `sources` e `jobs` e aggiunge le colonne
  dei prospect in una sola transazione con un solo backup per avvio; rifiutata con un job vivo.
- **TD-25 di crm-foundation** solo parzialmente chiuso da T6 (blocker di configurazione su "Riprova"; resta il
  passaggio da preview/costo): stato corretto nel tech debt di crm-foundation.
- **Candidate senza dati Apollo** se l'arricchimento si ferma a metà ricerca: salvate con punteggio parziale e
  mai ripunteggiate (AL-TD-1).
- **Fake e2e passano dal client reale** con un `fetch` finto (T16): gli scenari d'errore producono le stesse
  classi e gli stessi testi della produzione.

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| `npm run typecheck` (base) | verde | prima di T0 |
| `npm test` (base) | 234/238 | 4 falliti preesistenti, `.env` locale (vedi sopra) |
| `npm --prefix web run build` + `typecheck` (base) | verde | |
| `npm run apollo:smoke -- … --yes` (eseguito dall'utente) | 4/4 HTTP 200 | ≈ 4 crediti; esiti in PLAN §7 |
| 4 gate dopo wave E (T5) | verdi | vitest 392/392 |
| 4 gate dopo wave F (T4b, T7a, T7c, T8, T10, T11) | verdi | vitest 467/467 (aggiornato `app-skeleton.test.ts`: le route non sono più stub 501) |
| 4 gate dopo wave G (T7b, T6, T12a) + T9 | verdi | vitest 500/500 |
| 4 gate dopo T15/T17 + fix copy referenze | verdi | vitest 517/517; exit code 0 di entrambi i typecheck verificato esplicitamente |
| Validazione browser T12a, T12, T13, T14, T15 | OK | agent-browser contro il server fake, screenshot in scratchpad; processi fermati per PID |
| Smoke end-to-end T18 (`tests/e2e/smoke-apollo.md`) | 89 OK · 4 attriti · 4 bug MINOR | nessun BLOCKER/MAJOR; tracer con 4 preview, crediti dichiarati fino a 58 / usati 37 |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| A1–I3 (tutti) | non verificati in questa sessione | Audit dei criteri escluso dall'utente (Steering 2026-09-17). Evidenze disponibili per la sessione di audit: test vitest per task (log in PLAN), validazioni browser T12a–T15, smoke T18 con esito per riga FLOW, bug noti AL-TD-6…11 |

## Pre-existing Issues

- `tests/setup.ts` non isolava i parametri di config dal `.env` locale (corretto in T1).
- TD di crm-foundation non in ambito restano aperti (review DO NOT SHIP del 2026-09-16), in particolare TD-29
  (dati personali nel repo pubblico): rilevante prima di qualunque push.

## Steering

| Date | Feedback | Changes |
|------|----------|---------|
| 2026-09-17 | "Il flusso migliore: individuate le aziende e la loro compatibilità, scegliere se arricchirne i contatti o no; altrimenti Search + reveal all" | S-6: triage aziende invariato + contatti = ricerca gratuita + match per id (crediti dichiarati) |
| 2026-09-17 | Smoke reale eseguito dall'utente prima di T7b | Script riallineato a `requests.ts`, ≈ 4 crediti; esiti in PLAN §7 |
| 2026-09-17 | "Arricchisci le nuove" (punteggio candidate) | S-7: arricchimento delle candidate nuove nel job di ricerca, pagina 25 · 50 · 100 |
| 2026-09-17 | "Passaggi di simplify e verifica di criteri e review UX non farli in questa sessione" | Esclusi da questo run: `$simplify`, audit dei criteri di accettazione (lifecycle §11) e walkthrough `ux-advisor` (§12); restano in Remaining Work |

## Out of Scope Observations

- Lacune server minori notate dai worker FE: l'API aziende non distingue "non trovata" da "chiavi in conflitto"
  (`apollo_json` non esposto); preview di arricchimento singolo a 0 crediti con `est_cost_usd: 0` invece di
  `null`; nessun `max_pages` nella preview della ricerca (il dialog lo scopre dal 400).
- Smoke T18: attriti minori non durevoli (toast che coprono card e paginazione a 1280px, colonna "Perché simile"
  troncata, "fino a" assente nella riga di costo, storico ricerche senza pagina letta): elencati in
  `tests/e2e/smoke-apollo.md`.

## Remaining Work

- **Esclusi da questa sessione per scelta dell'utente**: `$simplify` sul diff, audit dei criteri A–I (tabella sopra
  da compilare) e walkthrough `ux-advisor` sulle schermate con `UX-REVIEW.md`.
- **Tech debt aperto** in [[tech-debt/prospect-crm/apollo-lookalike]]: AL-TD-1, 2, 3, 4, 6, 7, 8, 9, 10, 11 (tutti
  MINOR; AL-TD-5 chiuso nel run).
- **Prima di un commit/push**: rivedere a mano `tests/fixtures/apollo/smoke/*.json` (risposte reali
  anonimizzate) e ricordare TD-29 di crm-foundation; nessun commit dei cambiamenti di questa spec è stato fatto.
- **Dopo le revisioni di prodotto**: `adversarial-review` in una **nuova sessione** sul prodotto congelato, poi
  `docs-maintenance` dopo un verdetto SHIP (contract del dominio da aggiornare: doppia chiave aziende, nuovi job
  kind e source kind, candidate, eccezione "permesso persone scoperto al primo job").
