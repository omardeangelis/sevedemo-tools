---
domain: prospect-crm
type: implementation-notes
spec: crm-foundation
links:
  - "[[specs/prospect-crm/crm-foundation/PLAN]]"
  - "[[specs/prospect-crm/crm-foundation/FLOW]]"
ingested: false
last_ingested: null
created: 2026-09-16
updated: 2026-09-16
---

# Implementation Notes — `crm-foundation`

## Summary

- Esecuzione del PLAN `crm-foundation` (pivot Lead Engine → CRM di prospecting LinkedIn), 20 task in 7 ondate.

## Execution Mode

- `parallel` — ondate da `depends_on` del PLAN §8/§13. Worker = subagent `general-purpose` nello stesso working tree
  (nessun `.agents/subagents/manifest.mjs` nel repo: template di worker non disponibili, brief scritti dall'orchestratore
  secondo `parallel-worker-brief.md`).
- **Single writer** per `PLAN.md` e `IMPLEMENTATION-NOTES.md`: i worker restituiscono log, file toccati e gotcha;
  l'orchestratore li trascrive dopo la review di ogni task (evita edit concorrenti sullo stesso file).

## Deviations From the Plan

- **Helper HTTP condiviso** `src/server/http.ts` (`readJson`, `idParam`, `httpError`) + `tests/http-helpers.test.ts`,
  scritti dall'orchestratore prima della W2 (RED → GREEN) per evitare tre copie parallele in T4/T5/T6. Non è in
  nessuna `location` del PLAN; convenzioni API comuni (errori `{error, code?}`, `{items}` / paginazione, 202 `{job}`)
  passate a tutti i worker server.
- **Identità a due chiavi (steering, prima della W3)**, scritta dall'orchestratore RED → GREEN fuori dalle
  `location` dei task (tocca file di T3/T4/T5/T7 già Done): colonna `prospects.member_urn` (unica se presente) +
  indice su `full_name`; `src/db/identity.ts` (`identityKeys`, `resolveProspect`, `applyIdentity`,
  `mergeProspects`, `setProspectIdentity`); `upsertProspect(input{memberUrn?}, {refresh?, linkByName?}) →
  {id, created, mergedIds}`; `util/fields.ts` → `memberIdOf`, `profileKeys` e slug pubblico `/in/` in minuscolo
  (id membro invariato); mapper reazioni/commenti/dipendenti → `memberUrn` (dipendenti: `publicIdentifier` vince
  sull'URL in forma id). Test: `tests/prospect-identity.test.ts` (15) + casi in `schema`, `mappers-reactions`,
  `mappers-employees`, `post-extract`; attese aggiornate in `api-prospects` (`mergedIds`) e `api-settings` (slug
  minuscolo). PLAN §5/§6/rischi e T8/T9/T10, FLOW (edge case slug + YAGNI) e contract aggiornati.
- **409 per job in corso, uniforme (W3)**: i brief di T9/T10/T11 chiedevano 400 `blocked` anche per il job in corso;
  T8 ha seguito il contratto di T6 e il FLOW (409 `job_running` da `launchJob`). L'orchestratore ha allineato
  `routes/companies.ts` e `routes/enrich.ts` (RED: 2 test `expected 400 to be 409` → GREEN) e corretto T11 in corso.
  Regola: la preview elenca tutti i blocchi; l'avvio dà 400 `blocked` solo per quelli di configurazione.
- **T11 esteso a `src/db/prospects.ts`** (decisione orchestratore): stato di analisi per riga e valori `fit`
  `rifiutata`/`errore`/`non_arricchibile` di FLOW E.4, rinviati da T5 e senza altro proprietario.
- **`max_tokens` dell'analisi 16 000** (PLAN T11: 4000), cambiato dall'orchestratore al gate W3: con Opus 5 il
  ragionamento conta nel limite e 4000 rischiava `stop_reason:'max_tokens'` sulle chiamate reali.
- **Nessuna `SPEC.md`**: dichiarato dal PLAN stesso. Contratto di accettazione = story CRM-S0…S8 (§12) + `validation`
  dei task + FLOW.md. In finalizzazione si aggiorna lo status nella spec map invece del frontmatter di `SPEC.md`.

## Surprises and Decisions

- Advisor dati/schema: nessuno definito nel progetto (`## Project Advisors` vuoto) → pass saltato per T3/T4/T5 (schema
  già fissato in §6 e verificato SHIP in planning).
- T1: le entry storiche di `brain/log.md` mantengono wikilink `lead-engine` ora pendenti (log append-only, lasciati).
- T2: `npm run typecheck` verde già a fine T2 (il piano ammetteva rosso su `src/db/index.ts`). `web/src/routeTree.gen.ts`
  non è più tracciato: il typecheck web richiede un `build` prima.
- T7: nomi campo input di `harvestapi/linkedin-company-employees` **confermati** dall'endpoint pubblico delle build Apify
  (chiude la questione aperta §15). `profileScraperMode` accetta stringhe con il prezzo dentro (`'Short ($4 per 1k)'`…).
  Start fee harvestapi $0,02 per run non prevista in §5 → passata a T9.
- T7 ⚠️ **identità**: `apimaestro/linkedin-post-reactions` restituisce spesso `reactor.profile_url` in forma URN
  (`/in/ACoAA…`), i commentatori in forma slug. L'invariante "identità = `linkedin_url` normalizzato" non deduplica
  la stessa persona tra reazione e commento nei dati reali (i test con deps fake non lo vedono). **Risolto su
  steering** (vedi Deviations). Verificato sulle build pubbliche Apify: reazioni = `reactor.urn` sempre + URL spesso
  in forma id; commenti = solo `author.profile_url` slug (nessun id); harvestapi = `id` + `publicIdentifier`;
  profile-detail accetta l'id e restituisce l'URL canonico. Caso residuo: reazione solo-id e commento solo-slug con
  nome **o** headline diversi restano due prospect finché l'arricchimento (T10, `setProspectIdentity`) non li unisce.
  `ACoAA…` e `ACwAA…` della stessa persona sono stringhe diverse: confronto letterale.
- T3: `@anthropic-ai/sdk` 0.126.0 + `zod` 4.6.5. Aggiunti oltre al piano: `onError` JSON globale in `app.ts` (nessun
  task può più toccarlo), CHECK di coerenza su `sources` (`post_*` ⇒ `post_id`, `company_employees` ⇒ `company_id`),
  fallback SPA di `server/index.ts` che salta `/api`. `APIFY_TOKEN` fittizio in `tests/setup.ts` per readiness
  deterministica. Il `pnpm` nel PATH (9.14.2) non legge lo store v10 di `node_modules`: usare `/usr/local/bin/pnpm`.
- T4: `readiness` estesa con `icp` e `prospects` per l'onboarding; PUT settings parziale. Un ICP con liste (anche
  archiviate) non è mai cancellabile (`lists.icp_id` RESTRICT, nessun delete di liste): il copy FLOW "archiviale prima"
  non vale.
- T6: `GET /api/jobs/current` ritorna il job in corso **o l'ultimo terminato**; retry consentito solo sui `failed`;
  testi 409/crash dal FLOW. Check-then-insert del job non in transazione (sicuro con un solo processo server).
- T5: `upsertProspect` in backfill di default (`{refresh:true}` per sourcing Full ed enrichment); `routes/lists.ts`
  importa gli helper di query da `routes/prospects.ts`; filtri `fit` rifiutata/errore/non arricchibile (FLOW E.4)
  demandati a T11.
- T9: start fee harvestapi $0,02 inclusa nella stima (Short 50 = $0,22: T19 e FLOW D.2 aggiornati); in Full/Full+email
  `refresh:true` e `raw_json` con la stessa busta di profile-detail `{source, experience, education, certifications}`.
  `from-url` non accetta `listId` (FLOW D.1 lo cita: vale il PLAN).
- T10: un errore del provider **non** stampa `enrichment_attempted_at` (riprovato; la UI non lo marca "non
  arricchibile"). `enrichProspects(params, deps)` a 2 argomenti. `enrichOneInline` non lancia e restituisce l'esito.
- T8: `raw` dell'item salvato solo in `sources.raw_json`; un post mai sincronizzato si legge una volta a qualunque età;
  l'ultima pagina di reazioni è pagata intera anche se troncata dal cap.
- T11: About compilato a mano vale come dato di profilo (analisi senza arricchimento); `fit=none` ora esclusivo;
  nessun refusal fallback lato server (richiede client beta, cambierebbe 502/`rifiutata`: decisione aperta);
  endpoint sincrono di analisi in modalità fake → 500 finché T20 non riempie `fakeDeps('analyze')`.
- T12: `.gitignore` `exports/` ignorava anche `src/exports/` (il commit avrebbe perso il modulo): ancorato a
  `/exports/` dall'orchestratore. CSV senza BOM, formule neutralizzate, `prospect_ids` congelati all'export,
  `markContacted` solo su `nuovo/qualificato/da_contattare`; extra `GET /api/lists/:id/exports/preview` per il conteggio live.
- T13: nuovo toaster a 4 toni (`toast`) accanto al vecchio `pushToast` ancora montato; proxy Vite su `API_URL`; home
  reindirizza a `/inbox` solo con profilo + ICP + almeno un prospect; in agent-browser `visibilityState=hidden`.
  Titolo `web/index.html` corretto dall'orchestratore.
- T20: `__fixture` letto dal job via `JOB_ID` nel figlio; per sourcing/enrichment/analisi sincrona i trigger sono
  nei dati (slug/testo). `scripts/` non è coperto da `npm run typecheck` (candidato T17).
- W5 (FE): Vite dev non genera le classi Tailwind dei file di route creati dopo l'avvio (riavviare; build ok). Toast
  persistenti in basso a destra possono coprire controlli allineati a destra (T14). `/icps/nuovo` per creare un ICP.
  T15: azioni "Sulla lista" con filtri attivi usano gli id filtrati; "Avvia" abilitato anche con 0 target; focus su
  `body` dopo Aggiungi a lista/Scarta. T16: elimina attività con conferma (irreversibile); "Scrivi About" come recupero.
  `web/.tanstack/` non tracciato (preesistente, giugno): candidato `.gitignore` (T17).
- T19: `JobPreviewDialog` (T13) poteva mostrare la preview dell'apertura precedente con "Avvia" abilitato durante il
  refetch: l'orchestratore disabilita "Avvia" finché la preview è in aggiornamento (vale per tutti i dialog; il server
  blocca comunque config e job in corso). "Riprova con altri filtri" nello storico ricerche del dettaglio azienda.
- W7: il `pkill -f "scripts/e2e-server.ts"` di T17 ha fermato una volta il server di T18 (dopo un passo in sola
  lettura; T18 ha ripreso a DB vuoto); regola "stop per PID" aggiunta in `AGENTS.md`. T17 ha rimosso lo script
  `build` (compilava in un `dist/` inutilizzato) e incluso `scripts/` nel typecheck. Tech-debt di T18 collegato in
  `brain/index.md`.
- Divergenza PLAN/FLOW: FLOW E.3 cita `GET /api/lists/:id/analyze/preview`; il PLAN (T11) definisce
  `GET /api/analyze/preview?listId=`. Vale il PLAN (contratto dei task).

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| Baseline `npm run typecheck` | ✅ | prima di T1/T2 |
| Baseline `npx vitest run` | ✅ 25 file / 131 test | prima di T1/T2 |
| Gate W1 `npm run typecheck` | ✅ | dopo T3 (e T7 già completato) |
| Gate W1 `npx vitest run` | ✅ 9 file / 61 test | dopo T3 |
| Gate W1 `npm --prefix web run build && typecheck` | ✅ | dopo T3 |
| Gate W1 brain link-check (T1) | ✅ PASS | script scratchpad, 0 wikilink rotti |
| Gate W2 `npm run typecheck` | ✅ | dopo T4/T5/T6 |
| Gate W2 `npx vitest run` | ✅ 17 file / 111 test | dopo T4/T5/T6 |
| Gate W2 `npm --prefix web run build && typecheck` | ✅ | nessun processo job/vite residuo |
| Fix identità: RED | ✅ atteso | `prospect-identity` → `Cannot find module src/db/identity.js`; 3 casi mapper `memberUrn` falliti |
| Fix identità `npm run typecheck` | ✅ | dopo `db/identity.ts` |
| Fix identità `npx vitest run` | ✅ 18 file / 128 test | attesa `api-settings` aggiornata allo slug minuscolo |
| W3 T9/T10 verifica orchestratore | ✅ 53/53 | `prospect-identity`, `source-company`, `enrich-prospects`, `profile-detail` |
| W3 allineamento 409 | ✅ 32/32 | `source-company` + `enrich-prospects` dopo il RED |
| Gate W3 `npm run typecheck` | ✅ | dopo T8/T9/T10/T11 + `max_tokens` 16 000 |
| Gate W3 `npx vitest run` | ✅ 23 file / 211 test | |
| Gate W3 `npm --prefix web run build && typecheck` | ✅ | nessun processo job/vite residuo |
| Gate W4 `npm run typecheck` | ✅ | dopo T12/T13/T20 |
| Gate W4 `npx vitest run` | ✅ 25 file / 238 test | |
| Gate W4 `npm --prefix web run typecheck && build` | ✅ | nessun processo vite/API/e2e/agent-browser residuo |
| Gate W5 `npm run typecheck` | ✅ exit 0 | dopo T14/T15/T16 |
| Gate W5 `npx vitest run` | ✅ 25 file / 238 test | T16 ha visto 1 fallimento non catturato in 1 run su 5 sotto carico (build concorrente) |
| Gate W5 `npm --prefix web run typecheck && build` | ✅ | nessun processo residuo; revisione screenshot T14/T15/T16 |
| Gate W6 `npm run typecheck` + `npx vitest run` | ✅ exit 0 · 25 file / 238 test | dopo T19 + fix `JobPreviewDialog` |
| Gate W6 `npm --prefix web run typecheck && build` | ✅ | nessun processo residuo |
| Gate W7 `npm run typecheck` (ora include `scripts/`) | ✅ exit 0 | dopo T17/T18 |
| Gate W7 `npx vitest run` | ✅ 25 file / 238 test | |
| Gate W7 `npm --prefix web run build && typecheck` | ✅ | nessun processo residuo |
| T17 grep legacy su README/AGENTS/.env.example | ✅ vuoto | ripetuto dall'orchestratore |
| T18 smoke e2e (27 passi + 14 non felici) | ✅ | console pulita, header CSV esatto; 22 voci MINOR in tech-debt |
| `adversarial-review` (caso B, 16 pass) | ❌ DO NOT SHIP · critical | [[specs/prospect-crm/crm-foundation/REPORT]]: 5 BLOCKER, 11 MAJOR, 23 MINOR; gate verdi (v15) |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| CRM-S0, S1, S5 | Met | vedi REPORT |
| CRM-S3, S4, S6, S7 | Met con riserve | vedi REPORT (M3, M5, M8, M11, m9, m10, m12, m17) |
| CRM-S2, S8 | Unmet | bloccati da B3, B4, B5 e M5–M7, M10 del REPORT |
| Invarianti locale/senza auth, anti-doppia-spesa, `data/` intoccabile | Unmet | B1, M1, B3, B2 del REPORT |

## Pre-existing Issues

- Root usa `pnpm` (`pnpm-lock.yaml`, layout `node_modules/.pnpm`) mentre gli script dicono `npm run …`; `web/` usa `npm`
  (`package-lock.json`).

## Steering

| Date | Feedback | Changes |
|------|----------|---------|
| 2026-09-16 | "Alla fine di T5 fermati" | Esecuzione sospesa dopo il gate W2: W3 (T8–T11) non lanciata. |
| 2026-09-16 | "Continua da dove il piano si è fermato, prima puoi risolvere questa cosa però?" (identità reazione/commento) | Fix identità a due chiavi con unione automatica prima della W3; T8/T9/T10 ricevono il contratto; poi ripresa da W3. |
| 2026-09-16 | "Segna in un docs quali sono i problemi individuati e da risolvere più avanti" | Remediation rinviata; problemi della review registrati in tech-debt (TD-23…TD-71) con ordine di remediation. |

## Remaining Work

- Completati: T1–T20 + fix identità; `adversarial-review` eseguita → **DO NOT SHIP** (critical,
  [[specs/prospect-crm/crm-foundation/REPORT]]). Remediation **rinviata** dall'utente (2026-09-16): tutti i problemi
  della review sono in `brain/tech-debt/prospect-crm/crm-foundation.md` (TD-23…TD-71, con ordine di remediation).
  Poi: nuovo round di review in una sessione nuova, audit di accettazione, finalizzazione.
- Tech-debt scritto da T18 in `brain/tech-debt/prospect-crm/crm-foundation.md` (22 voci MINOR, incluso il caso residuo
  dell'identità come TD-1).
