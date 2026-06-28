---
domain: lead-engine
type: review-rubric
spec: influencer-post-respondents
links:
  - "[[specs/lead-engine/influencer-post-respondents/SPEC]]"
  - "[[specs/lead-engine/influencer-post-respondents/PLAN]]"
ingested: false
last_ingested: null
created: 2026-06-17
updated: 2026-06-17
---

# Review Rubric — influencer-post-respondents (case B)

Routing rubric emessa da `review-classifier`. Guida il fan-out dei verifier.

- **taskType**: feature (secondary: migration)
- **taskComplexity**: high
- **reviewImpact**: critical
- **humanInLoop**: true
- **gates**: `npm test` (vitest), `npm run typecheck` (tsc server + tests), `npm run ui:build`; frontend via agent-browser; no lint gate.

## Passes

| id | concern | complexity | model |
|----|---------|------------|-------|
| v1 | Migrazione DB: backfill rename one-shot idempotente + guarded (no-op su legacy), colonne additive in `migrate()` non nello SCHEMA statico; nessuna riga fuori dall'id rinominato mutata | high | opus |
| v2 | Budget `gather()`: una sola `source()` per strategia, `remaining` decrementa sui candidati resi (non sul cap), primaria 0 → no under-fill, single-strategy → full limit, off-by-one supply mista (AC3) | high | opus |
| v3 | SQL selezione + report: azienda-first solo su azienda + perSectorCap/eleggibilità preservati (AC4); report LEFT JOIN runs, 4 stati derivati corretti, drill-down per sotto-fonte, invariante "unica fonte due viste" (AC5) | high | opus |
| v4 | Invariante identità/dedup: `normalizeLinkedinUrl` unica chiave; tagged-person GATED OFF di default, URN irrisolvibili scartati (non fabbricati); company-expansion dedup per companyUrn cross-post (AC2 + rischio RH) | high | opus |
| v5 | Mapper estrazione + adapter actor: purezza/tolleranza `field()`, D9 (solo annotation top-level, reshared ignorato), comment+reply→commenter con fallback `post_input`, scarto senza profile_url, id/builder actor coerenti, nessun actor cookie attivato (AC1, codice/test — T14 live differito) | medium | sonnet |
| v6 | Regressione/AC6: suite vitest verde, typecheck pulito, web build verde; nessun residuo `freelance-post-reactors` in src/scripts (solo backfill in db/index.ts), seed-demo non semina la strategia fantasma, propagazione `sourceDetail` type-consistent, strategie/selezione 20+20/geo-gate/eval:import intatti | medium | sonnet |

## Next step
Fan-out 6 verifier indipendenti sul working tree (NON sullo smoke T14 non eseguito). Checklist umana obbligatoria (reviewImpact=critical) su: (1) comportamento del backfill `migrate()` su un DB prod-shaped reale; (2) acknowledgement che AC1 resta pending live smoke (T14) e tagged-person è shipped gated-off.
