---
name: create-plan
description: Creates execution-ready `PLAN.md` artifacts by explicitly wrapping `grill-me`, `swarm-plan`, and `tdd` into one planning run. Use when work must be decomposed before coding, especially for reviewed spec workflows, multi-agent execution, branch-scoped delivery, or any task that needs explicit dependencies, backlog items, review gates, and per-task RED targets.
---

# Create Plan

## Contract

- **Role:** higher-order planning orchestrator
- **Entrypoint type:** public entrypoint
- **Upstream:** approved `SPEC.md` or explicit planning request
- **Delegates to:** `$grill-me`, `$swarm-plan`, `$tdd`
- **Downstream:** execution-ready `PLAN.md` for `implement-spec`
- **Entry conditions:** scope is clear enough to plan; stop if required planning inputs or tools are missing
- **Stop conditions:** `PLAN.md` and backlog sync are complete; no implementation started

## Required Inner Skills

- MUST use `$grill-me`
- MUST use `$swarm-plan`
- MUST use `$tdd`

Create a plan first. Never implement code in this skill.

## Quick start

1. Read repo, git, existing plan, and backlog context before asking questions.
2. Keep a visible planning control panel in the conversation: locked decisions, open decisions, current phase, and next step.
3. Read `references/grill-phase.md` and run `$grill-me` as an explicit inner phase.
4. Update a running decision ledger after every answer so the user never has to reconstruct state from memory.
5. Insert a synthesis checkpoint before the thread gets noisy, then continue only if more ambiguity reduction is still needed.
6. Research with your code-search tool (or Context7 for library docs / web search) and primary-source web docs when current behavior matters.
7. Read `references/planner-phase.md` and run `$swarm-plan` as an explicit inner phase.
8. **If any planned task touches the data/schema layer** (new tables, columns, FKs, indexes, constraints, or migrations) **and this project defines a schema/data advisor agent** (see `## Project Advisors` — not shipped by default), invoke it via the `Agent` tool. Brief it with the SPEC excerpt that drives the schema change, the surveyed current models, and the proposed direction. Incorporate its trade-off discussion into the plan **before** the TDD phase. Advisors discuss trade-offs one at a time in prose; do not batch-question them.
9. **If the spec or plan touches a user-facing flow**, invoke the **`ux-advisor`** agent via the `Agent` tool to pressure-test the implementation order (e.g., empty-state first, error recovery before polish, the highest-anxiety moment first). If the spec folder already has a `FLOW.md`, read it first and brief the advisor with it rather than re-deriving the flow; turn its happy/error/edge paths into concrete tasks and sequencing constraints in the plan. Shipped by default; skip if absent.
10. Read `references/tdd-phase.md` and run `$tdd` as an explicit inner phase.
11. Read `references/backlog-sync.md` and sync backlog at epic/story level, not one item per plan task.
12. **Verify the plan without spending orchestrator context:** delegate to the **`adversarial-verifier`** agent in quality-gate mode — brief it self-contained with the drafted `PLAN.md`, the `SPEC.md` acceptance criteria, and `FLOW.md` (if present) as the acceptance contract. It hunts for task-graph gaps, missing error/edge coverage, unsafe ordering, and decisions that contradict the spec. Fold any BLOCKER back into the plan before stopping. Skip only if the agent is absent; if your tool cannot spawn subagents, run its charter inline instead (see `brain/AGENTS.md` → Advisor subagents).
13. Read `references/stop-conditions.md` and stop exactly there.

## Workflows

### Default workflow

1. Derive host, owner, tracker, and scope from repo state instead of assuming them.
2. Ask only for missing high-impact inputs such as scope, goal, or backlog target.
3. Every plan-shaping question must use the exact block: `Decision`, `Recommendation`, `Question`, `Why it matters`.
4. Keep `$grill-me`, `$swarm-plan`, and `$tdd` as visible required inner phases of one planning run. Insert the `ux-advisor` pass (and any project advisor from `## Project Advisors`) between `$swarm-plan` and `$tdd` when their triggers fire (Quick start steps 8–9), and run the `adversarial-verifier` plan gate after backlog sync (step 12).
5. Normalize every task with stable ids, `depends_on`, `location`, `description`, `validation`, `status`, `log`, `files edited/created`, owning-story backlog references, `tdd_target`, and `review_mode`.
6. Keep the saved plan standalone: include situation, issue, solution shape, assumptions, findings, research, dependency graph, testing strategy, risks, validation gates, unresolved questions, and a resolved decision ledger.
7. Stop after plan creation and backlog sync. Do not implement code or spawn implementation workers.

### Review modes

- `cli`: tests, commands, APIs, non-visual validation
- `browser`: interactive UI validation via `$agent-browser`
- `mixed`: both are required

Add `agent-browser` to a task's `assigned_skills` whenever its `review_mode` is `browser` or `mixed`.

## Advanced features

See [REFERENCE.md](REFERENCE.md) for the overview and phase map.

- Grill / ambiguity-reduction phase: see [references/grill-phase.md](references/grill-phase.md)
- Planner / task-graph phase: see [references/planner-phase.md](references/planner-phase.md)
- TDD shaping phase: see [references/tdd-phase.md](references/tdd-phase.md)
- `PLAN.md` schema and task contract: see [references/plan-schema.md](references/plan-schema.md)
- Backlog sync rules: see [references/backlog-sync.md](references/backlog-sync.md)
- Stop conditions: see [references/stop-conditions.md](references/stop-conditions.md)

## Project Advisors

The shipped advisor agents — **`ux-advisor`** (implementation-order pressure-test from `FLOW.md`) and **`adversarial-verifier`** (plan quality-gate) — are already wired into the Quick start steps above. List any *additional* project-specific advisors here — most commonly a **schema/data** advisor (Quick start step 8), which is not shipped by default — and init-brain will pick them up. When a trigger matches, delegate via the `Agent` tool with `subagent_type: "<agent-name>"`, briefed self-contained; advisors shape decisions before code is written.

<!-- init-brain:advisors:start -->
_No project advisor agents detected beyond the shipped defaults. If this project defines more agents under `.claude/agents/` or `.agents/agents/`, list each here as: **`<name>`** — trigger — when to delegate._
<!-- init-brain:advisors:end -->
