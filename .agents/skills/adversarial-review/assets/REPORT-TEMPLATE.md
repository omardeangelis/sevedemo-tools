---
domain:                       # case B: spec domain. case A: best-fit domain or _unscoped
type: review
scope:                        # spec | standalone
spec:                         # case B: spec id/folder name. case A: null
review_target:                # PR #N | branch <name> | path glob | "spec implementation"
base_ref:                     # ref compared from (the merge-base / base ref you diffed)
head_ref:                     # ref compared to
verdict:                      # ship | do-not-ship
review_impact:                # low | medium | critical
human_in_loop:                # true | false
links:
  # case B (artifacts in the spec folder) — sibling rubric + spec backlinks:
  - "[[specs/<domain>/<spec>/RUBRIC]]"
  - "[[specs/<domain>/<spec>/SPEC]]"
  - "[[specs/<domain>/<spec>/PLAN]]"
  - "[[specs/<domain>/<spec>/FLOW]]"
  - "[[specs/<domain>/<spec>/IMPLEMENTATION-NOTES]]"
  # case A instead — only the sibling rubric, no spec links:
  # - "[[review/<slug>/RUBRIC]]"
ingested: false
last_ingested: null
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Review Report: [Review Target]

<!--
INSTRUCTIONS (remove this block before saving):
- Consolidate every adversarial-verifier verdict into this single report.
- Overall verdict is DO NOT SHIP if any verifier holds an unresolved BLOCKER, any claim is CONTRADICTED in a way
  that matters, or any required pass could not run on a critical review.
- Mark each durable finding so docs-maintenance can fold it into tech-debt without re-judging.
- Remove sections that don't apply (drop "Acceptance criteria check" for case A).
-->

## Verdict

**SHIP | DO NOT SHIP** · impact: low | medium | critical

_If DO NOT SHIP: the single strongest blocking objection, stated plainly._

## Coverage

- Rubric passes run: <n>/<n> (model per pass)
- Passes skipped or failed: <none — or list; a missing pass on a critical review is DO NOT SHIP until re-run>

## Findings

| Severity | Concern (verifier) | Location | Problem | Required fix / evidence | Durable? |
|----------|--------------------|----------|---------|-------------------------|----------|
| BLOCKER  | v1 — <charter>     | `file:line` | | | yes/no |
| MAJOR    | | | | | |
| MINOR    | | | | | |
| NIT      | | | | | |

_"Durable?" = yes when the finding will not be fixed before ship and should be carried into `tech-debt/` during ingest._

## What passed

| Concern (verifier) | Evidence |
|--------------------|----------|
| v1 — <charter> | |

## Per-concern verdicts

| Pass | Charter | Verdict | Rationale |
|------|---------|---------|-----------|
| v1 | | SHIP / DO NOT SHIP | |

## Human Review Checklist

<!-- REQUIRED when review_impact: critical. For medium, use a shorter "Suggested manual validation". Omit for low. -->

_Ordered, concrete steps a human must follow before anything proceeds — what to re-verify, where, and what "good" looks like (include running the project's declared gates from the root AGENTS.md)._

1.
2.

## Acceptance criteria check (case B)

| Criterion | Met / Unmet / Blocked | Notes |
|-----------|-----------------------|-------|
| | | |

_Error paths and edge cases from `FLOW.md` count here — an unhandled one is Unmet, not optional._

## Notes for docs-maintenance

- Durable findings to fold into `tech-debt/<domain>/<spec>.md` (case B) or `tech-debt/<best-fit-domain>/<slug>.md` (case A): <list, or "none">
- Domain pages that should backlink this review: <list, or "n/a (standalone)">
