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
  sopra il commit di base `7a33339` (stato di crm-foundation, solo locale); committato in `9630bad`. `$simplify`,
  emende SPEC e questi aggiornamenti sono nel working tree, non ancora committati.
- Consegnato: configurazione e readiness Apollo, smoke reale manuale (`npm run apollo:smoke`), identità azienda a
  doppia chiave con migrazione e backup, arricchimento Apollo delle aziende, ricerca di aziende simili con
  arricchimento delle candidate e punteggio v1, storico ricerche analizzabile, triage delle candidate, "Trova
  contatti" (ricerca + match per id) anche dal dettaglio azienda, email di lavoro via Apollo come secondo
  provider, pipeline opt-in, "Riprova" con i blocker di configurazione per tutti i job, fake e2e con scenari
  d'errore, UI di pagina ICP / Aziende / arricchimento, README e AGENTS.
- Due decisioni di prodotto prese durante il run sui fatti di Apollo (S-6, S-7) e registrate in SPEC, FLOW e
  PLAN. In una seconda sessione: `$simplify`, audit dei criteri (66/72 met; D12 e I2 chiusi emendando la SPEC) e
  poi fix dei 4 unmet (C5, C7, F10, G3) + AL-TD-4: **72/72 met**, tech debt aperto senza AL-TD-4, 7 e 11.
  Walkthrough `ux-advisor` rinviato dall'utente.

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
| Commit `9630bad` (tutto il run) | fatto | fixture smoke anonimizzate anche su ruolo, id Apollo e storico lavorativo delle persone (script + test); vitest 518/518 |
| 4 gate dopo `$simplify` (2026-09-17) | verdi | vitest 518/518; 64 file, saldo ≈ −400 righe |
| Controllo browser dopo `$simplify` | OK | triage candidata (una PATCH, niente preview ricaricata), conteggi card/sezione condivisi, dialog "Trova aziende simili", "Arricchisci" (una sola preview), chips "Cerca persone"; processi fermati per PID |
| Audit dei criteri (4 agenti read-only, vitest mirati) | 66 met · 6 unmet · 0 blocked | poi D12 e I2 emendati in SPEC (scelta utente): restano 4 unmet |
| Fix dei criteri unmet + AL-TD-4 (2026-09-17) | 4 gate verdi · vitest 520/520 | C5/G3 (stima `null` senza prezzo, testo FLOW del blocker), C7 (AL-TD-7), F10 (parziale su 401/403), blocker su lista/ICP cancellati; 5 test nuovi o aggiornati |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| A1–A5, B1–B14 | met | test in `api-settings`, `schema`, `company-identity`, `api-companies`, `source-company`, `apollo-smoke`; smoke A1, B*, F*. Note: B11 non permette di togliere un dominio Apollo a un'azienda senza `website`; B2 nel ripiego dell'arricchimento l'azienda tiene il proprio dominio |
| C1–C4, C6 | met | `enrich-companies`, `lookalike-preview`; smoke tracer 1, F7, F8 |
| C5 | met (fix 2026-09-17) | `estimateApolloCostUsd` / `estimateEnrichCostUsd` non hanno più la scorciatoia "0 crediti → 0": senza `APOLLO_CREDIT_USD` la stima è `null` e la UI dice "stima non disponibile" anche a 0 crediti. Test in `tests/enrich-companies.test.ts`, `tests/enrich-apollo.test.ts` (con prezzo configurato e 0 target → `0`) |
| C7 | met (fix 2026-09-17) | warning parziale onesto: "arricchite N su M" solo se le salvate sono tutte arricchimenti, altrimenti "elaborate N su M (X arricchite)" (chiude AL-TD-7); FLOW A.1b aggiornato |
| D1–D11, D13, D14, Regole di somiglianza | met | `lookalike-preview`, `lookalike-companies`, `apollo-similarity`, `candidates`, `apollo-client`; smoke A2–A12, EDGE1/3/5, ERR*. AL-TD-6 (azione nel toast) è debito sul FLOW, non su D11 |
| D12 | met (dopo emenda SPEC) | morte del processo esclusa dal criterio (P-15 / AL-TD-2), scelta utente 2026-09-17 |
| E1–E6 | met | `api-candidates`, `api-icps`, `apollo-people`; smoke B1–B8, C8, EDGE4/7 |
| F1–F9, F11, F12 | met | `apollo-people`, `list-export`; smoke C1–C9, EDGE6/11–13, F6/F7 |
| F10 | met (fix 2026-09-17) | `runApolloPeople` fallisce solo con `companies_done === 0`: un 401/403 dopo ≥ 1 azienda completata è un esito parziale riuscito, con il messaggio della chiave nel warning e il rimedio "sistema la chiave, poi rilancia". Test "401/403 alla 2ª azienda"; FLOW righe 401/403 aggiornate |
| G1, G2, G4–G7 | met | `enrich-apollo`, `apollo-client`; smoke D1–D6, ERR17. Nota G1: nel dettaglio prospect il default è Apollo se già arricchito e senza email (deviazione T14) |
| G3 | met (fix 2026-09-17) | stessa stima `null` di C5; con `provider: 'apollo'` il blocker della lista archiviata usa `archivedListText` (riga FLOW "Lista archiviata (C, D, E)"), Apify resta sul testo di crm-foundation |
| H1–H4 | met | `lookalike-preview`, `lookalike-companies`; smoke E1–E5, ERR9, EDGE10 |
| I1, I3 | met | `jobs`, `lookalike-preview`, `apollo-people`, `enrich-companies`; smoke ERR12 |
| I2 | met (dopo emenda SPEC) | chiude solo la parte "blocker di configurazione" di TD-25 (scelta utente); AL-TD-4 (Riprova su lista/ICP cancellati) chiuso il 2026-09-17 insieme ai criteri unmet |

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
| 2026-09-17 (seconda sessione) | "Committa tutte le modifiche e poi simplify e audit dei criteri. UX review rimandiamo" | Commit `9630bad`; `$simplify` (4 revisori + 4 agenti di fix, PLAN §12-bis "Dopo `$simplify`", AL-TD-11 chiuso); audit dei criteri; `ux-advisor` rinviato |
| 2026-09-17 | D12 e I2: "Emenda la SPEC" | SPEC D12 esclude la morte del processo; I2 chiude solo la parte blocker di TD-25; allineato anche il default `APOLLO_RATE_LIMIT_PER_MINUTE` = 20 in Constraints/Data model |
| 2026-09-17 | "Fermati, questi ultimi punti in un'altra sessione" | Fix di C5/G3, C7, F10, AL-TD-4 interrotti e annullati (working tree = stato post-simplify, 518/518) |
| 2026-09-17 | "Continua" (dopo il compact) | Ripresi e completati nella stessa sessione i fix di C5/G3, C7, F10 e AL-TD-4: criteri 72/72 met |

## Out of Scope Observations

- Lacune server minori notate dai worker FE: l'API aziende non distingue "non trovata" da "chiavi in conflitto"
  (`apollo_json` non esposto); preview di arricchimento singolo a 0 crediti con `est_cost_usd: 0` invece di
  `null`; nessun `max_pages` nella preview della ricerca (il dialog lo scopre dal 400).
- Smoke T18: attriti minori non durevoli (toast che coprono card e paginazione a 1280px, colonna "Perché simile"
  troncata, "fino a" assente nella riga di costo, storico ricerche senza pagina letta): elencati in
  `tests/e2e/smoke-apollo.md`.

## Remaining Work

- **Da committare**: `$simplify`, emende SPEC/PLAN, fix dei criteri e questi aggiornamenti (dopo `9630bad` nulla
  è committato).
- **Rinviato dall'utente**: walkthrough `ux-advisor` sulle schermate con `UX-REVIEW.md`.
- **Tech debt aperto** in [[tech-debt/prospect-crm/apollo-lookalike]]: AL-TD-1, 2, 3, 6, 8, 9, 10 (tutti MINOR;
  AL-TD-5 chiuso nel run, AL-TD-11 da `$simplify`, AL-TD-4 e AL-TD-7 dai fix dei criteri).
- **Prima di un push**: TD-29 di crm-foundation (repo pubblico con dati personali); le fixture smoke sono state
  anonimizzate anche su ruolo, id e storico lavorativo prima di `9630bad`.
- **Dopo le revisioni di prodotto**: `adversarial-review` in una **nuova sessione** sul prodotto congelato, poi
  `docs-maintenance` dopo un verdetto SHIP (contract del dominio da aggiornare: doppia chiave aziende, nuovi job
  kind e source kind, candidate, eccezione "permesso persone scoperto al primo job").
