---
domain: lead-engine
type: implementation-notes
spec: influencer-post-respondents
links:
  - "[[specs/lead-engine/influencer-post-respondents/SPEC]]"
  - "[[domains/lead-engine/flows/respondents-azienda-first]]"
  - "[[domains/lead-engine/flows/gather-primaria-budget-riflusso]]"
  - "[[domains/lead-engine/flows/selezione-azienda-first]]"
  - "[[domains/lead-engine/concepts/strategia-influencer-post-respondents]]"
  - "[[domains/lead-engine/concepts/sotto-fonte-respondents]]"
  - "[[domains/lead-engine/concepts/espansione-azienda-decisionmaker]]"
  - "[[domains/lead-engine/concepts/esito-strategia-onesto]]"
ingested: true
last_ingested: 2026-06-28
created: 2026-06-17
updated: 2026-06-17
---

# Implementation Notes — Influencer Post Respondents

## Summary

Eseguito il `PLAN.md` (T0–T13 in TDD; T14 manuale differito). `influencer-post-respondents`
è ora la **fonte primaria azienda-first**: estrae i **commentatori** dei post degli
influencer (apimaestro `profile-posts` + `post-comments`), le **persone taggate**
(gated-off) e le **aziende taggate** espanse a decision-maker (harvest people-search).
`gather` esegue la primaria per prima con budget dominante + riflusso (+ reclaim); la
selezione è azienda-first; il "Report strategie" è onesto (4 stati + drill-down sotto-fonte),
unica fonte per CLI e UI. Gate `adversarial-review`: **SHIP** (1 BLOCKER trovato e risolto).

## Execution Mode

- **sequential** — T3/T4/T5 condividono `src/strategies/post-extract.ts` e T11/T12
  `runs.ts`: le wave del PLAN non avevano write-scope disgiunti per il fan-out parallelo.
  Eseguito in ordine di dipendenza, RED-first per ogni task.

## Deviations From the Plan

- **T2**: il builder posts apimaestro è `profilePostsApimaestroInput` (non `profilePostsInput`)
  per non collidere col builder harvest omonimo (rimosso a T8). Stessa shape `{username,total_posts}`.
- **T6**: i config knob sono stati aggiunti in T6 (non T8) perché necessari a compilare la
  strategia; T8 ha fatto il resto (registry, seed-demo, `.env.example`, rimozione builder morti).
- **T5**: la parte "persone taggate diventano candidati" è implementata ma **gated-off**
  (`taggedPersonEnabled=false`) — l'enrichment daily usa `dev_fusion`, non apimaestro, e la
  risolvibilità dell'URN su quel path non è provata. Spike live batchato in T14.
- **T9 (post-review)**: aggiunta una **fase 3 "reclaim"** in `gather` per chiudere il BLOCKER
  di under-fill trovato dall'adversarial-review (primaria supply-rich + altre thin).

## Surprises and Decisions

- Baseline pre-esecuzione: `npm test` 81/81, typecheck pulito. Finale: 131/131.
- `APIFY_TOKEN` presente → T14 eseguibile, ma a costo + scrive sul DB di produzione →
  lasciato all'operatore (checklist umana nel REPORT.md).
- L'enrichment *daily* (`dev_fusion`) ≠ enrichment *progressivo* (apimaestro): per questo i
  `tagged-person` (URL da URN) restano gated-off finché lo spike non conferma. Vedi tech-debt.
- BLOCKER budget under-fill: il cap della primaria riserva budget alle altre per diversità;
  se non lo usano va recuperato dalla primaria (reclaim), altrimenti AC3 violato.

## Sanity Checks

| Check | Result | Notes |
|------|--------|-------|
| `npm test` | ✅ 131/131 (26 file) | server vitest |
| `npm run typecheck` | ✅ clean | tsc server + tsconfig.tests |
| `npm run ui:build` | ✅ clean | vite build web |
| UI report (`agent-browser`) | ✅ | 4 stati + drill-down sotto-fonte verificati su DB demo |
| `grep freelance-post-reactors src scripts` | ✅ solo backfill | unici residui = literal in `db/index.ts` |
| `adversarial-review` (case B) | ✅ SHIP | 6 verifier; 1 BLOCKER risolto + ri-verificato |
| T14 smoke reale | ⏸ differito | manuale/paid, scrive su DB prod — checklist operatore |

## Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC1 commentatori > 0 | **pending live** | mapper/orchestrazione/test OK; conferma reale = T14 |
| AC2 taggati persone+aziende | **partial** | aziende→espansione met; persone taggate gated-off (spike) |
| AC3 primaria prima + budget dominante + riflusso | **met** | + reclaim (BLOCKER risolto/ri-verificato) |
| AC4 azienda-first in selezione | **met** | verifier v3 SHIP |
| AC5 report 0/errore + 4 stati + sotto-fonte | **met** | verifier v3 SHIP + agent-browser |
| AC6 nessuna regressione | **met** | verifier v6 SHIP; suite/typecheck/build verdi |

## Remaining Work

- **T14 (operatore)**: smoke reale Apify `pipeline --strategy influencer-post-respondents
  --limit 50` → conferma AC1 (>0 commentatori) e forma payload commenti vs fixture.
  ⚠️ costo + scrive su DB prod. Vedi checklist nel REPORT.md.
- **Spike risolvibilità URN** (tagged-person): se passa → `TAGGED_PERSON_ENABLED=true` chiude
  la parte "persone taggate" di AC2; altrimenti resta debito (tech-debt §1).
- Tightening cosmetici accettati dal gate (tech-debt §1b, §3) — non bloccanti.

## Steering

| Date | Feedback | Changes |
|------|----------|---------|
| 2026-06-17 | adversarial-review: BLOCKER under-fill in `gather` | aggiunta fase reclaim + 3 nuovi test; 3 MINOR fixati (web Contact type, activityId truthiness, test dedup nome) |
