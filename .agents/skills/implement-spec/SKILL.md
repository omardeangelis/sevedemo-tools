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
- **Downstream:** product revisions (new `implement-spec` runs) until the product is stable, then `adversarial-review` **in a separate session**, then `docs-maintenance` when the resulting spec folder should be ingested into domain knowledge
- **Entry conditions:** existing reviewed spec folder; stop and use `create-plan` if `PLAN.md` is missing
- **Stop conditions:** shared acceptance audit complete, post-implementation UX walkthrough done (user-facing specs), spec folder finalized, blocked work reported honestly — never an `adversarial-review` in the same session

## Required Inner Skills

- MUST use `$tdd`
- MUST use `$simplify`
- Use `$agent-browser` when any task `review_mode` is `browser` or `mixed` (the bundled browser-driving tool; requires the `agent-browser` CLI — `npm i -g agent-browser`). Fall back to another browser-driving tool only if it is unavailable.

## Required Advisor Agents

**Pre-task** — before starting a task whose `location` matches a trigger (see [references/lifecycle.md](references/lifecycle.md) §6):

- data/schema-layer tasks → the project's schema/data advisor agent, if one is defined (see `## Project Advisors`; not shipped by default).

During tasks, `FLOW.md`'s error/edge paths are part of each user-facing task's acceptance surface, not optional polish.

**Post-implementation UX walkthrough** — after the acceptance audit, when the spec has a user-facing surface (see [references/lifecycle.md](references/lifecycle.md) §12):

- start the app as the root `AGENTS.md` prescribes for validation (fake/preview data, never paid services or real data) and run the **`ux-advisor`** agent on the **running screens**: it walks `FLOW.md` in the browser and writes `UX-REVIEW.md` into the spec folder (findings + proposed `FLOW.md` changes). It proposes, never applies: the user decides which revisions to make.

**No `adversarial-review` in this session** — see [references/lifecycle.md](references/lifecycle.md) §15:

- the independent quality gate runs only on a **frozen** product, in a **separate session** started by the user after the product revisions (including accepted `UX-REVIEW.md` proposals) are done. Any change after a review invalidates its verdict, so reviewing inside the implementation session brings no benefit. If asked to run it here, explain why and propose a fresh session.

Delegate to agents via the `Agent` tool with `subagent_type: "<agent-name>"`. If a needed advisor is absent, skip and say so. If your runtime cannot spawn subagents (most non-Claude tools), run the advisor's charter (`.agents/agents/<name>.md`) inline instead of skipping — see `brain/AGENTS.md` → Advisor subagents.

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
8. Run the shared acceptance audit, then the post-implementation UX walkthrough with `ux-advisor` on the running app (user-facing specs; see `## Required Advisor Agents`).
9. Finish with the spec finalization contract and stop. Hand the user the next steps: decide on `UX-REVIEW.md`, apply product revisions in new `implement-spec` runs, and only when the product is frozen run `adversarial-review` in a new session. Never run `adversarial-review` here.

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

The shipped advisor — the **`ux-advisor`** agent (post-implementation walkthrough on the running app) — is already wired into `## Required Advisor Agents` above; the **`adversarial-review`** skill is deliberately not part of this run (separate session on a frozen product). List any *additional* project-specific advisors here (e.g. a schema/data advisor for data-layer tasks) and init-brain will pick them up. When a task's `location` matches a trigger, delegate via the `Agent` tool with `subagent_type: "<agent-name>"` **before** starting that task.

<!-- init-brain:advisors:start -->
_No project advisor agents detected beyond the shipped defaults. If this project defines more agents under `.claude/agents/` or `.agents/agents/`, list each here as: **`<name>`** — trigger location — when to delegate._
<!-- init-brain:advisors:end -->
