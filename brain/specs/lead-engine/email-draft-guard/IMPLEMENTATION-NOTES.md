---
domain: lead-engine
type: implementation-notes
spec: email-draft-guard
links:
  - "[[specs/lead-engine/email-draft-guard/SPEC|email-draft-guard]]"
  - "[[domains/lead-engine/flows/bozze-email-guard]]"
  - "[[domains/lead-engine/concepts/presenza-email]]"
ingested: true
last_ingested: 2026-06-13
created: 2026-06-13
updated: 2026-06-13
---

# Implementation Notes — `email-draft-guard`

## Summary

- Guard di solo costo: `draftMany` salta la chiamata Sonnet per i contatti senza email
  (`null`/`''`/whitespace), ritornando `{ id, skipped: true }`; `runDaily` non scrive bozza, non
  emette warning spurio e logga il conteggio dei saltati. Contatti senza email restano in
  selezione/export con colonne vuote. Predicato unico `hasEmail` in `src/util/fields.ts`.
- Eseguito in 3 task TDD (T1→T2→T3), tutti RED→GREEN; suite completa 18/18 verde, typecheck pulito.

## Execution Mode

- `sequential` — catena lineare T1 → T2 → T3, tightly coupled, nessun beneficio dal fan-out.

## Deviations From the Plan

- Nessuna deviazione di scope. Unico aggiustamento (da `$simplify`): in `runDaily` il conteggio dei
  saltati è single-pass (`let skipped` incrementato nel loop) invece del doppio passaggio
  for-loop + `.filter().length` descritto nel piano — stesso comportamento, più pulito.

## Surprises and Decisions

- **Test seam senza rete**: il test di `draftMany` mocca `@anthropic-ai/sdk` (default export come
  classe, `messages.create` via `vi.hoisted`) e asserisce che il modello sia invocato **una sola
  volta** (solo il contatto con email). RED genuino: pre-guard `createMock` chiamato 4× invece di 1×.
- **Key fittizia in `tests/setup.ts`**: `config.anthropicApiKey` è letta a import-time, quindi la
  key va impostata nel setup (non nel body del test). Impostata a `'test-key'`: rende `requireAnthropic`
  deterministico su CI/clone senza `.env` e maschera l'eventuale key reale (i test non chiamano mai
  l'API vera).
- **Fork SQL/TS di "has email" lasciato intatto** (deciso nel piano): `getStats()` in
  `src/server/queries.ts` usa ancora l'inline SQL `email IS NOT NULL AND email <> ''`. È un layer
  diverso (stats read-only) e fuori scope per questa spec minimale; la segmentazione è della spec #3.
  Vedi Out of Scope.

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| `npm run typecheck` | ✅ pass | `tsc --noEmit` + `tsc -p tsconfig.tests.json --noEmit`, pulito |
| `npx vitest run tests/email-draft-guard.test.ts` | ✅ 3/3 | `hasEmail` (2) + guard `draftMany` (1) |
| `npx vitest run` (suite completa) | ✅ 18/18 | nessuna regressione (`boom della pipeline` è stderr atteso del test di crash job) |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| Nessuna chiamata Sonnet per contatto senza email | ✅ met | Guard in `draftMany`; T2 prova `createMock` chiamato 1× (solo con email) |
| Senza email → `email_subject`/`email_body` vuoti, nessun errore pipeline | ✅ met | `skipped` → niente `updateEmail` (colonne restano NULL) e niente `error`; T2 asserisce `error` undefined |
| Contatti senza email restano in selezione ed export con colonne vuote | ✅ met | Selezione/export non toccati; `skipped` non rimuove né riclassifica |
| Contatti con email ricevono la bozza come prima | ✅ met | Path con email invariato; T2 asserisce bozza generata |
| Numero di bozze saltate osservabile (log/telemetria) | ✅ met | `runDaily` logga il conteggio; fonte (`skipped`) coperta da T2. Stringa di log validata per ispezione (runDaily non offline) |
| Guard valido per CLI e web UI | ✅ met | Entrambi → `runDaily` → `draftMany`; guard al chokepoint |
| "Senza email" = null/vuota/solo spazi | ✅ met | `hasEmail` (`typeof === 'string' && trim() !== ''`); T1 |

## Out of Scope Observations

- `getStats().withEmail` (`src/server/queries.ts:201`) mantiene la propria definizione SQL inline di
  "has email" (`email <> ''`, non considera il whitespace-only). Divergenza minore e innocua qui
  (reporting read-only); candidata naturale a unificazione quando la spec #3 toccherà la
  segmentazione per presenza email.

## Remaining Work

- Nessuno. Tutti i criteri di accettazione soddisfatti.
