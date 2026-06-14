---
domain: lead-engine
type: implementation-notes
spec: italy-geo-gate
links:
  - "[[specs/lead-engine/italy-geo-gate/SPEC]]"
  - "[[domains/lead-engine/flows/gate-geografico-italia]]"
  - "[[domains/lead-engine/concepts/classificazione-geografica]]"
  - "[[domains/lead-engine/concepts/stato-rejected-geo]]"
ingested: true
last_ingested: 2026-06-14
created: 2026-06-14
updated: 2026-06-14
---

# Implementation Notes — `italy-geo-gate`

## Summary

- Doppio gate geografico dentro il chokepoint condiviso `enrichAndScore` (`src/pipeline/run.ts`):
  pre-enrichment conservativo (scarta solo `foreign` leggendo `raw_json`, **prima** del costo Apify),
  post-enrichment strict (tiene solo `italy` leggendo `contacts.location`).
- Tutta la logica decisionale in un nuovo modulo puro/testabile `src/pipeline/geo-gate.ts`
  (`classifyLocation`, `locationFromRaw`, `applyGeoGate`, `runGeoGatePre/Post`) + tombstone DB
  `markRejectedGeo` in `src/db/contacts.ts` (nuovo status terminale `rejected_geo` + stamp
  `last_evaluated_at`).
- 6 task T1→T6 in TDD RED→GREEN. 28 nuovi test in `tests/italy-geo-gate.test.ts`; suite intera
  53 test verdi, typecheck pulito.

## Execution Mode

- **sequential** — spec piccolo, codice quasi tutto in un nuovo modulo + 2 punti di wiring; nessun
  advisor di progetto definito; `rejected_geo` è un nuovo *valore* di status (nessun cambio schema).

## Deviations From the Plan

- Nessuna deviazione sostanziale. Il piano è stato seguito task per task. Dettagli minori coerenti col
  piano: `runGeoGatePre/Post` condividono un helper privato `runGeoGate(rows, mode)` (il piano li
  descriveva separati; l'helper evita duplicazione del try/catch fail-open senza cambiarne il contratto).

## Surprises and Decisions

- **Matching per token, accenti inclusi**: `classifyLocation` normalizza con
  `split(/[^\p{L}\p{N}]+/u)` (Unicode-aware) e confronta frasi delimitate da spazi. Questo dà
  word-boundary reale (`"india"` non matcha dentro `"indiana"`) e gestisce `"Città del Vaticano"`
  (à come lettera) e le abbreviazioni puntate (`"U.S."` → `u s`, matchata dal token `u.s.`).
- **Ordine della procedura = correttezza della collisione**: "paese estero domina" (step 1) prima del
  check Italia/enclavi (step 2) fa sì che `"San Marino, California, United States"` resti `foreign`
  mentre `"San Marino"` da solo è `italy` (D8).
- **Lista-paesi `foreign` completa** (~195 + abbreviazioni + nomi IT dei più frequenti): necessaria
  perché la località di people-search è spesso il solo paese (es. `"Cyprus"`); un paese non in lista
  cadrebbe in `unknown` e sfuggirebbe al pre-gate (lo catturerebbe comunque il post-gate, solo costo).
- **Fail-open testabile**: `vi.spyOn(contacts, 'markRejectedGeo')` intercetta la chiamata *dentro*
  `geo-gate.ts` (live binding di Vite/vitest) → ho potuto verificare che un throw del tombstone fa
  ritornare `rows` intatte + warning, senza perdere righe.
- **Fix critico anti-leak nel return di `enrichAndScore`**: il return finale ora usa `gated`, non
  `rows`. Senza, le righe tombstonate sarebbero rientrate nel valore di ritorno e nell'export di
  `runStrategy` (AC#1/AC#4). `runDaily` non usa il valore di ritorno (interroga il DB, già ripulito).

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| `npm test` (file nuovo) | ✅ 28/28 | RED→GREEN dimostrato per ogni task T1–T5 |
| `npm test` (suite intera) | ✅ 53/53, 8 file | nessuna regressione |
| `npm run typecheck` | ✅ pulito | `tsc --noEmit` + `tsc -p tsconfig.tests.json` |
| Lettura wiring `enrichAndScore` | ✅ | pre prima di `enrichProfiles`; post (`gated`) prima di `scoreMany`; return su `gated` |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC#1 — ogni `selected`/`exported` è riconducibile all'Italia (tutti i bucket) | ✅ met | post-gate strict tiene solo `italy`; solo le righe `scored` proseguono; `selectBucket` richiede `status='scored'`; `rejected_geo` non raggiunge mai `scored` |
| AC#2 — scarto nel punto più economico (pre se località nel raw, post altrimenti) | ✅ met | `runGeoGatePre` legge `raw_json` **prima** di `enrichProfiles` (no costo Apify); `runGeoGatePost` dopo l'enrichment |
| AC#3 — italiano con nome/nazionalità estera mantenuto | ✅ met | `classifyLocation` guarda solo la stringa di località, mai il nome |
| AC#4 — scartati assenti da selezione/export/pool UI; in Contatti come `rejected_geo` | ✅ met | escluso per costruzione da `selectBucket`/`listCandidates`/export (mai `scored`); `searchContacts` lo mostra come status osservabile |
| AC#5 — numero scartati osservabile | ✅ met | `console.log` `  → geo-gate (pre\|post): scartati N profili fuori Italia` |
| AC#6 — pin upstream + difesa downstream (cintura + bretelle) | ✅ met | `profileSearchInput location:'Italy'` invariato; gate aggiunto come layer difensivo a valle |
| AC#7 — gate non allentato per il target 20+20 | ✅ met | nessuna logica di rilassamento; la selezione resta più corta se gli italiani sono meno |

Nota verifica: AC#1/AC#2/AC#4/AC#6 dipendono dal wiring di orchestrazione in `enrichAndScore`, che
chiama Apify/Anthropic e per convenzione del repo **non** è unit-testato; verificato da typecheck +
suite verde + lettura del flusso. La logica decisionale sottostante è coperta da unit test (T1–T5).

## Out of Scope Observations

- **Taratura della lista di token geografici** (`classifyLocation`): la lista regioni/città IT e città
  estere è curata ma non esaustiva. Va monitorata sui conteggi loggati di `geo-gate (pre|post)`: se
  emergono falsi negativi ricorrenti (italiani con sola città non in lista → `unknown` → scartati dal
  post-gate) o paesi mancanti, ampliare le liste. Nessun *drift* durevole oggi → nessun file
  `tech-debt/` creato (da creare solo se i log di un run reale mostrano il problema).
- I filtri UI per lo status `rejected_geo` sono fuori scope (Non-Goal: sono un'altra spec).
- Cleanup dei non-italiani già in DB: fuori scope (forward-only, Non-Goal).

## Remaining Work

- Nessuna. Tutti i 7 AC sono `met`; tutti i task T1–T6 `Done`.
