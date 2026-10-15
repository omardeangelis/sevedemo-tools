# Parallel Execution

Use this approach when execution should fan out across independent tasks or waves.

When `implement-spec` chooses `parallel` mode, this reference is the full contract for parallel execution.

## Parallel contract

- **Mode:** `parallel`
- **Worker policy:** spawn workers only for currently unblocked work, one per task, on the tier [delegation.md](delegation.md) assigns
- **Execution board:** completed, in progress, unblocked next, blocked, current wave

## Adoption rule

In `parallel` mode, `implement-spec` must do all of the orchestration work itself.

That includes:

1. parsing `PLAN.md`
2. extracting task ids, names, `depends_on`, locations, descriptions, acceptance criteria, validations, and related metadata
3. building the current wave from the unblocked tasks
4. preparing each task's RED contract and spawning its worker
5. reviewing worker results for correctness and completeness, and escalating failures
6. updating plan logs and execution notes (workers never write them)
7. repeating until all reachable tasks are complete or a real blocker remains

Do not treat worker spawning as the whole job. The orchestration loop is part of this mode.

## Quick start

1. Load the shared lifecycle from `lifecycle.md`.
2. Read [delegation.md](delegation.md) and resolve the delegation policy.
3. Record `parallel` and the delegation policy under **Execution mode** in `IMPLEMENTATION-NOTES.md`.
4. Read [parallel-orchestration.md](parallel-orchestration.md) and parse `PLAN.md` into a task graph.
5. Build the current wave from the unblocked tasks only.
6. Read [worker-brief.md](worker-brief.md) and use that contract when spawning workers.
7. Validate each wave before moving on. Fix failures before the next wave.
8. Update the plan, notes, and tech debt after every wave.

## Required evidence

- plan-derived wave selection
- explicit worker briefs per task, each on the tier its `complexity` names
- post-wave review of worker outputs
- acceptance-criteria coverage plus RED -> GREEN evidence, or explicit non-testable verification
- task completion only after validation and plan/log updates
- clear reporting of retries, escalations, issues, or blockers

## Loop rule

Keep iterating wave by wave until:

- all reachable tasks are complete, validated, and logged
- or a real blocker remains and is reported honestly

Do not quietly skip failed work. Climb the escalation ladder in [delegation.md](delegation.md) instead.
