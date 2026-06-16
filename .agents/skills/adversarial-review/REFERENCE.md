# Adversarial Review Reference

`adversarial-review` is the orchestrator. It does not review code itself — it routes the work through two agents in a fixed order (classify, then verify) and persists the result as a brain artifact. Stop only after `RUBRIC.md` and `REPORT.md` are written and brain bookkeeping is complete.

## Required agents

- MUST use the `review-classifier` agent — Stage 1, produces the routing RUBRIC. Run it exactly once per review. Delegate via the `Agent` tool with `subagent_type: "review-classifier"`.
- MUST use the `adversarial-verifier` agent — Stage 2, run once per `passes[]` entry in the RUBRIC, each with an isolated charter and a clean context. Delegate via the `Agent` tool with `subagent_type: "adversarial-verifier"`.
- Use your code-search / git tooling to gather the change set before Stage 1, and read the root `AGENTS.md` to learn the project's gates.

## Phase map

1. Resolve scope and gather the artifact:
   - see [references/scope-and-naming.md](references/scope-and-naming.md)
2. Run the classification phase (classifier agent → `RUBRIC.md`):
   - see [references/classification-phase.md](references/classification-phase.md)
3. Run the verification phase (one verifier per rubric pass, in parallel):
   - see [references/verification-phase.md](references/verification-phase.md)
4. Synthesize the report (`REPORT.md`, verdict, human checklist):
   - see [references/report-synthesis.md](references/report-synthesis.md)
5. Sync brain bookkeeping (frontmatter, index, log, tech-debt link):
   - see [references/brain-bookkeeping.md](references/brain-bookkeeping.md)
6. Stop:
   - see [references/stop-conditions.md](references/stop-conditions.md)

## Two cases at a glance

| | Case A — standalone | Case B — spec implementation |
|---|---|---|
| Trigger | generic code, no spec in scope | a spec folder exists and was implemented |
| Output folder | `brain/review/<slug>/` (create `brain/review/` if missing) | `brain/specs/<domain>/<spec>/` (alongside `SPEC.md`/`PLAN.md`/`FLOW.md`) |
| Acceptance contract | derived rubric (no spec) | `SPEC.md` acceptance criteria + `FLOW.md` |
| Backlinks | none to a spec | `SPEC.md`, `PLAN.md`, `IMPLEMENTATION-NOTES.md` |
| `docs-maintenance` | ingest on request; tech-debt under best-fit domain | ingested alongside the spec; folds findings into `tech-debt/<domain>/<spec>.md` |

## Global rules

- Keep the skill project-agnostic: derive the change set from git/PR state, and read the project's gates from the root `AGENTS.md` and its conventions/risk surface from `brain/` rather than assuming a stack.
- Classification always precedes verification. Never reorder.
- One verifier = one isolated, non-overlapping concern. Prefer the classifier's count; do not silently merge passes.
- Verifiers never receive authorship, effort, prior approvals, or persuasion cues. Detachment is the source of the signal.
- This skill never edits code. It produces a verdict and a persisted report; remediation happens elsewhere.
- Map verifier complexity to a model tier (low → fast, medium → balanced, high/critical → strongest available), never a hardcoded vendor id.
- If a required agent is unavailable, stop clearly and report the missing dependency.
