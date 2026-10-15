---
name: implement-spec
description: Implement an approved spec folder while keeping `IMPLEMENTATION-NOTES.md`, `PLAN.md`, and spec-linked tech debt in sync. The orchestrator supervises — it delegates each task to a worker on the model tier the task's `complexity` names, reviews the result, and escalates failures. Use when a reviewed spec already has a `PLAN.md` and execution should proceed either sequentially or in parallel waves.
---

# Implement Spec

## Contract

- **Role:** higher-order execution orchestrator
- **Entrypoint type:** public entrypoint
- **Upstream:** reviewed spec folder with `SPEC.md` and `PLAN.md`
- **Delegates to:** `$tdd`, `$simplify`, and tiered workers it supervises (per `execution.delegation`)
- **Downstream:** `adversarial-review` (independent quality gate before finalizing, per `review.mode`), then `docs-maintenance` when the resulting spec folder should be ingested into domain knowledge
- **Entry conditions:** existing reviewed spec folder; stop and use `create-plan` if `PLAN.md` is missing
- **Stop conditions:** shared acceptance audit complete, spec folder finalized, blocked work reported honestly

## Required Inner Skills

- MUST use `$tdd`
- MUST use `$simplify`
- Use `$agent-browser` when any task `review_mode` is `browser` or `mixed` (the bundled browser-driving tool; requires the `agent-browser` CLI — `npm i -g agent-browser`). Before the first `agent-browser` command, run `agent-browser skills get core` and follow it: it is the usage guide for the installed version. Fall back to another browser-driving tool only if it is unavailable.

## Required Advisor Agents

**Pre-task** — before starting a task whose `location` matches a trigger (see [references/lifecycle.md](references/lifecycle.md) §6):

- user-facing-flow tasks → no advisor: `ux-advisor` reviewed the prototype before the spec was written. Treat the `SPEC.md` criteria that `FLOW.md` cites (states, accessibility, persona dependencies) as part of the task's acceptance surface, not optional polish. When implementation reveals friction no criterion covers, log it in `IMPLEMENTATION-NOTES.md` and raise it with the user.
- static UI tasks (placement, widths and wrapping, contrast, focus-indicator visibility, target size, accessible names) → no advisor: `ui-reviewer` reviewed the prototype before the spec was written, and its decisions are `SPEC.md` criteria the plan turned into tasks. Build to them; on the implemented change, the UI pass of `adversarial-review` verifies static UI.
- motion and interaction craft tasks (a `review_mode: browser` task carrying motion targets, or any task where an animation decision surfaces beyond `PLAN.md`) → the **`design-engineer`** agent (shipped) to resolve the exact values and the implementation route before the RED test; while writing the motion code, follow the `design-engineering` skill's `references/implementation.md` and `references/accessibility.md` (every movement ships its reduced-motion variant). The agent advises only; it never writes the code.
- data/schema-layer tasks → the project's schema/data advisor agent, if one is defined (see `## Project Advisors`; not shipped by default).

**Post-implementation gate** — before the shared acceptance audit / finalization:

- **Gate — `review.mode` ∈ {total}:** run the **`adversarial-review`** skill as an independent, bias-free quality gate on the implementation (case B — it writes `RUBRIC.md` + `REPORT.md` into the spec's review folder, per `review.location`, and returns a SHIP / DO NOT SHIP verdict). It spawns `review-classifier` + `adversarial-verifier` in clean contexts, so the audit barely touches the orchestrator's context. Resolve any BLOCKER before finalizing. — otherwise offer it in one line and continue.
- A `PLAN.md` task that lists review as a closing step follows the same gate: executed under `total`, otherwise offered, not run. An explicit request from the user runs the review in every mode.

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

1. Read `brain/brain.config.json` (keys in `brain/AGENTS.md` → Project configuration). If it is absent, use the defaults listed there. Resolve the target spec folder under `brain/specs/<domain>/<spec>/`.
2. Read `references/lifecycle.md` and follow the shared execution contract exactly.
3. Choose the execution mode explicitly:
   - Read `references/sequential.md` for one-task-at-a-time execution.
   - Read `references/parallel.md` for wave-based worker execution.
4. Read `references/delegation.md` and resolve `execution.delegation` (default `supervised`). Record the mode and the delegation policy under **Execution mode** in `IMPLEMENTATION-NOTES.md` before coding.
5. Execute only the chosen mode. Do not mix modes inside one run.
6. After each completed task or wave, update `PLAN.md`, `IMPLEMENTATION-NOTES.md`, and spec-linked tech debt (`<techDebt>/<domain>/<spec>.md`) before advancing.
7. If backlog sync is in scope, keep epic/story bodies product-facing and use native metadata or comments instead of execution handoff rewrites.
8. **Gate — `review.mode` ∈ {total}:** before the acceptance audit, run the **`adversarial-review`** skill on the implementation (case B) as the independent quality gate and resolve any BLOCKER it reports (see `## Required Advisor Agents`). — otherwise offer it in one line and continue.
9. If `SPEC.md` cites a `prototype` surface (path + route), delete that folder and its dev-only route as part of finalization — the winner is now implemented (the prototype skill's Hard Rule 5) — and record the removal in `IMPLEMENTATION-NOTES.md`.
10. Finish with the shared acceptance audit and spec finalization contract.

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

## Delegation

Delegation is independent of the mode: the mode decides how many tasks run at once, delegation decides who writes each task's code. Under `execution.delegation: supervised` (the default) you are the supervisor in both modes:

- each task goes to one worker on the tier its `complexity` names (`low` → fast, `medium` → balanced, `high` → strongest)
- you write the RED contract first, review every result yourself, and send back a concrete fix proposal when it fails
- after two failed reviews, a worker one tier up takes the task; after that, you do it or report the blocker
- only you write `PLAN.md`, `IMPLEMENTATION-NOTES.md`, and tech debt

`inline` turns this off: you execute `sequential` tasks yourself. The full contract is [references/delegation.md](references/delegation.md).

## Advanced features

- Shared lifecycle, notes contract, tech-debt rules, acceptance audit, finalization: see [references/lifecycle.md](references/lifecycle.md)
- Sequential execution specifics: see [references/sequential.md](references/sequential.md)
- Parallel execution specifics: see [references/parallel.md](references/parallel.md)
- Parallel plan parsing and wave construction: see [references/parallel-orchestration.md](references/parallel-orchestration.md)
- Delegation, model tiers, review and escalation ladder: see [references/delegation.md](references/delegation.md)
- Worker brief contract (both modes): see [references/worker-brief.md](references/worker-brief.md)

## Project Advisors

The shipped advisors — the **`design-engineer`** agent (pre-task motion decisions) and the **`adversarial-review`** skill (post-implementation quality gate, per `review.mode`) — are already wired into `## Required Advisor Agents` above. List any *additional* project-specific advisors here (e.g. a schema/data advisor for data-layer tasks) and init-brain will pick them up. When a task's `location` matches a trigger, delegate via the `Agent` tool with `subagent_type: "<agent-name>"` **before** starting that task.

<!-- init-brain:advisors:start -->
_No project advisor agents detected beyond the shipped defaults. If this project defines more agents under `.claude/agents/` or `.agents/agents/`, list each here as: **`<name>`** — trigger location — when to delegate._
<!-- init-brain:advisors:end -->
