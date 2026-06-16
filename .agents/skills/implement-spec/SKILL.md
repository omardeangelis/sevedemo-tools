---
name: implement-spec
description: Implement an approved spec folder while keeping `IMPLEMENTATION-NOTES.md`, `PLAN.md`, and spec-linked tech debt in sync. Use when a reviewed spec already has a `PLAN.md` and execution should proceed either sequentially in one thread or in parallel with explicit worker orchestration.
---

# Implement Spec

## Contract

- **Role:** higher-order execution orchestrator
- **Entrypoint type:** public entrypoint
- **Upstream:** reviewed spec folder with `SPEC.md` and `PLAN.md`
- **Delegates to:** `$tdd`, `$simplify`, and internal worker orchestration in parallel mode
- **Downstream:** `adversarial-review` (independent quality gate before finalizing), then `docs-maintenance` when the resulting spec folder should be ingested into domain knowledge
- **Entry conditions:** existing reviewed spec folder; stop and use `create-plan` if `PLAN.md` is missing
- **Stop conditions:** shared acceptance audit complete, spec folder finalized, blocked work reported honestly

## Required Inner Skills

- MUST use `$tdd`
- MUST use `$simplify`
- Use `$agent-browser` when any task `review_mode` is `browser` or `mixed` (the bundled browser-driving tool; requires the `agent-browser` CLI — `npm i -g agent-browser`). Fall back to another browser-driving tool only if it is unavailable.

## Required Advisor Agents

**Pre-task** — before starting a task whose `location` matches a trigger (see [references/lifecycle.md](references/lifecycle.md) §6):

- user-facing-flow tasks → the **`ux-advisor`** agent (shipped) when UX friction surfaces beyond `SPEC.md`/`FLOW.md`. Treat `FLOW.md`'s error/edge paths as part of the task's acceptance surface, not optional polish.
- data/schema-layer tasks → the project's schema/data advisor agent, if one is defined (see `## Project Advisors`; not shipped by default).

**Post-implementation gate** — before the shared acceptance audit / finalization:

- run the **`adversarial-review`** skill as an independent, bias-free quality gate on the implementation (case B — it writes `RUBRIC.md` + `REPORT.md` into the spec folder and returns a SHIP / DO NOT SHIP verdict). It spawns `review-classifier` + `adversarial-verifier` in clean contexts, so the audit barely touches the orchestrator's context. Resolve any BLOCKER before finalizing.

Delegate to agents via the `Agent` tool with `subagent_type: "<agent-name>"`; invoke the `adversarial-review` skill via the Skill tool. If a needed advisor is absent, skip and say so. If your runtime cannot spawn subagents (most non-Claude tools), run the advisor's charter (`.agents/agents/<name>.md`) inline instead of skipping — see `brain/AGENTS.md` → Advisor subagents.

## Parallel responsibilities

When `implement-spec` runs in `parallel` mode, it must follow [references/parallel.md](references/parallel.md) as the full orchestration contract.

That means `implement-spec` itself owns all of the following in parallel mode:

- parsing `PLAN.md`
- finding the currently unblocked tasks from `depends_on`
- launching workers in waves
- reviewing worker outputs
- validating each wave before advancing
- ensuring `PLAN.md` and `IMPLEMENTATION-NOTES.md` are updated after each completed wave

## Quick start

1. Resolve the target spec folder under `brain/specs/<domain>/<spec>/`.
2. Read `references/lifecycle.md` and follow the shared execution contract exactly.
3. Choose the execution mode explicitly:
   - Read `references/sequential.md` for one-thread execution.
   - Read `references/parallel.md` for wave-based worker execution.
4. Record the chosen mode under **Execution mode** in `IMPLEMENTATION-NOTES.md` before coding.
5. Execute only the chosen mode. Do not mix modes inside one run.
6. After each completed task or wave, update `PLAN.md`, `IMPLEMENTATION-NOTES.md`, and spec-linked tech debt before advancing.
7. If backlog sync is in scope, keep epic/story bodies product-facing and use native metadata or comments instead of execution handoff rewrites.
8. Before the acceptance audit, run the **`adversarial-review`** skill on the implementation (case B) as the independent quality gate and resolve any BLOCKER it reports (see `## Required Advisor Agents`).
9. Finish with the shared acceptance audit and spec finalization contract.

## Mode selection

Choose `sequential` when:

- the user wants single-threaded execution
- tasks are tightly coupled
- worker handoff cost would outweigh parallelism

Choose `parallel` when:

- the user wants explicit parallel execution
- the plan contains independent waves
- disjoint write scopes make worker fan-out safe

If the user already chose a mode, honor it. If not, make the smallest safe choice and state it.

## Advanced features

- Shared lifecycle, notes contract, tech-debt rules, acceptance audit, finalization: see [references/lifecycle.md](references/lifecycle.md)
- Sequential execution specifics: see [references/sequential.md](references/sequential.md)
- Parallel execution specifics: see [references/parallel.md](references/parallel.md)
- Parallel plan parsing and wave construction: see [references/parallel-orchestration.md](references/parallel-orchestration.md)
- Parallel worker brief contract: see [references/parallel-worker-brief.md](references/parallel-worker-brief.md)

## Project Advisors

The shipped advisors — the **`ux-advisor`** agent (reactive UX friction) and the **`adversarial-review`** skill (post-implementation quality gate) — are already wired into `## Required Advisor Agents` above. List any *additional* project-specific advisors here (e.g. a schema/data advisor for data-layer tasks) and init-brain will pick them up. When a task's `location` matches a trigger, delegate via the `Agent` tool with `subagent_type: "<agent-name>"` **before** starting that task.

<!-- init-brain:advisors:start -->
_No project advisor agents detected beyond the shipped defaults. If this project defines more agents under `.claude/agents/` or `.agents/agents/`, list each here as: **`<name>`** — trigger location — when to delegate._
<!-- init-brain:advisors:end -->
