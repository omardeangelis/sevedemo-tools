---
domain: lead-engine
type: implementation-notes
spec: email-segmentation-filters
links:
  - "[[specs/lead-engine/email-segmentation-filters/SPEC|email-segmentation-filters]]"
  - "[[specs/lead-engine/email-segmentation-filters/PLAN|PLAN]]"
  - "[[domains/lead-engine/flows/segmentazione-presenza-email]]"
  - "[[domains/lead-engine/flows/filtri-persistenti-url]]"
  - "[[domains/lead-engine/flows/export-email-ready]]"
  - "[[domains/lead-engine/concepts/stato-filtri-url]]"
  - "[[domains/lead-engine/concepts/presenza-email]]"
ingested: true
last_ingested: 2026-06-14
created: 2026-06-13
updated: 2026-06-14
---

# Implementation Notes — `email-segmentation-filters`

## Summary

- **Completata.** Tutti i 10 task (S1–S4, C1, F1–F5) implementati e validati. Branch dedicato
  `lead-engine/email-segmentation-filters` (creato dal branch della spec #2 `email-draft-guard`).
  Server read-side via vitest (25/25 verde, +7 nuovi test in `tests/email-segmentation.test.ts`);
  frontend validato end-to-end con `agent-browser` contro l'app reale (F1–F5 tutti PASS). Tutti e 4
  gli Outcome della SPEC soddisfatti.

## Execution Mode

- **parallel** — fan-out su **lane a file disgiunti**, serializzazione dentro ogni lane.

## Deviations From the Plan

- **Riorganizzazione delle ondate (vs PLAN §8).** Il PLAN ipotizzava S1/S2/S3 in parallelo, ma i
  quattro task server **scrivono gli stessi file** (`src/server/app.ts` + il test condiviso
  `tests/email-segmentation.test.ts`, più `queries.ts`/`csv.ts`): fan-out concorrente = conflitti.
  Riorganizzato in lane a scope disgiunto:
  - **Wave 1 (parallelo):** Worker A = lane server (S1→S2→S3→S4 in sequenza, unico owner del cluster
    `src/server/*` + `src/export/csv.ts` + test) · Worker B = lane client (C1, solo `web/src/api/*`).
    File disgiunti → safe.
  - **Wave 2 (serializzata):** Worker C = FE contatti (F1→F2 su `contacts.index.tsx`) **poi** Worker D
    = FE selezioni (F3→F4→F5 su `selections.$date.tsx`). I file sorgente sono disgiunti, ma
    condividono il gate `tsc`/dev-server project-wide di `web/`: due `tsc` concorrenti mentre l'altro
    file è a metà edit darebbero falsi fallimenti → lane serializzate. Solo codice + `tsc` (browser in
    Wave 3).
  - **Wave 3 (singola):** validazione `agent-browser` consolidata di tutti i `tdd_target` FE contro
    **una sola** istanza dell'app (evita conflitti di porta/DB/browser tra worker concorrenti).
  - C1 non aspetta S1/S2 a runtime: il contratto `email=with|without` è già bloccato nel PLAN, quindi
    Worker B gira in parallelo a Worker A.

## Surprises and Decisions

- **Hono route ordering**: `/api/contacts/export.csv|.json` registrati **prima** di `/contacts/:id`,
  altrimenti il param `:id` cattura `export.csv`. Annotato nel codice.
- **Refactor per riuso (non puramente additivo)**: estratti `contactsWhere()` + `CONTACTS_ORDER`
  (condivisi da `searchContacts` e `listContactsForExport`) e `contactFiltersFromQuery()` (condiviso
  da `/contacts` e dai due export Contatti). Comportamento invariato, coperto dai test esistenti +
  nuovi.
- **`email_ready` anche negli export CLI**: `toCsv` è usato pure da `exportContacts` (CLI/pipeline) →
  la colonna compare lì. Intenzionale/additivo; nessun test asseriva la forma del CSV, niente rotto.
- **Due `isEmailReady` indipendenti** (server `app.ts`, client `client.ts`): nessun modulo condiviso,
  coerente con lo split di file-scope; stessa definizione non-trim.
- **`toJsonRow`** preserva il comportamento originale dell'export selezione JSON (`signals` parsato,
  `raw_json` droppato) e aggiunge `email_ready` — nessuna regressione.
- **Server stale in ascolto (Wave 3)**: un'istanza `npm run ui` di una sessione precedente teneva la
  porta 8787 con codice vecchio → la prima validazione browser colpiva l'API vecchia (filtro email
  ignorato, export 404 via `/contacts/:id`). Risolto killando i processi su 8787/5173/5174 e
  riavviando un'unica istanza pulita. Lezione: prima della validazione browser verificare che l'API
  in ascolto serva il codice corrente (smoke su `/api/contacts/export.csv` + `?email=`).

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| `npm test` (finale) | ✅ 25/25 (7 file) | era 18 baseline, +7 nuovi (`tests/email-segmentation.test.ts`), nessuna regressione |
| `npm run typecheck` (root) | ✅ clean | src + tests |
| `npm --prefix web run typecheck` | ✅ clean | FE combinato (C1 + F1–F5) |
| `agent-browser` F1–F5 | ✅ tutti PASS | app reale su :5173; persistenza URL, toggle export, conteggi/segmento, filtro pool, link export |
| smoke API nuovo codice | ✅ | `email=with`→36 / `without`→98; `export.csv` ha colonna `email_ready`; selezione `export.json?email=with`→14 righe con `email_ready` |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| **Outcome 1** — filtro tri-state presenza email su Contatti, componibile, conteggio coerente, def. `getStats` | ✅ Met | S1 (server, test) + F1 (UI tri-state, browser) |
| **Outcome 2** — filtri persistenti nell'URL (dettaglio↔lista, navigazione, reload, link condivisibile, `page` inclusa); reset sessione | ✅ Met | F1 (validateSearch hand-rolled, browser PASS); reset cross-sessione garantito dalla natura URL/sessione (niente storage) |
| **Outcome 3** — export "solo email-ready" + flag `email_ready` per riga; senza-email non persi; export non distruttivo. Esteso a Contatti (OQ#2) | ✅ Met | S3+S4 (server, test), F2 (Contatti: link filtrati + toggle), F5 (Selezioni: link `?email=with`) |
| **Outcome 4** — conteggi pronti/da-arricchire per bucket, distinzione visiva, segmento dedicato (OQ#3), filtro email nel pool | ✅ Met | F3 (conteggi + segmento "Da arricchire", browser PASS: fre 3/17, az 11/9), F4 (filtro pool) |

## Pre-existing Issues

- Nessuna emersa.

## Out of Scope Observations

> Entrambe le voci sono ora tracciate in
> [[../../../tech-debt/lead-engine/email-segmentation-filters|tech-debt/lead-engine/email-segmentation-filters]].

- Plumbing client `sector`/`minFit` resta non esposto (la SPEC lo nota ma è fuori scope): aggiunto
  solo `email`. Candidato a un futuro cleanup di allineamento `ContactFilters`. → tech-debt **TD-2**.
- Tre definizioni di "email presente" coesistono nel codice: `hasEmail` (trim, `src/util/fields.ts`,
  spec #2) vs il predicato non-trim usato qui (filtro SQL + `email_ready` + `isEmailReady`). Coerenti
  entro questa spec; unificarle in un unico predicato condiviso è tech-debt futuro. → tech-debt **TD-1**.

## Remaining Work

- Nessuno. Tutti i task Done, tutti gli Outcome Met. Commit/push lasciati all'utente (non richiesti).
