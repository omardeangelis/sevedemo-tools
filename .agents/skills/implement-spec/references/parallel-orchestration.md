# Parallel Orchestration

Use this reference to run the full parallel orchestration loop inside `implement-spec`.

## Step 1: Parse request

Extract from the user request:

1. the plan source to execute
2. an optional task subset

If no subset is provided, execute the full plan.

## Step 2: Read and parse `PLAN.md`

Find task subsections such as:

- `### T1:`
- `### Task 1.1:`

For each task, extract:

- task id and task name
- `depends_on`
- full content needed for execution:
  - location
  - description
  - acceptance criteria
  - validation
  - `tdd_target`
  - `review_mode`
  - `complexity`
  - backlog metadata when present
  - related tasks or plan-level constraints when they materially shape execution

Build the task list from this data.

If a task subset was requested:

- filter to the requested tasks
- include every required dependency first

## Step 3: Build the current wave

A task is unblocked only when all ids in its `depends_on` list are complete.

For the current wave:

- collect every unblocked task
- exclude already-complete tasks
- exclude tasks blocked by failed prerequisites

Launch all unblocked tasks in parallel.

## Step 4: Spawn workers

For each unblocked task:

- prepare its RED contract first (delegation task loop, step 1) — for the whole wave before any spawn
- pick the model tier from its `complexity` per [delegation.md](delegation.md)
- use the worker-brief contract from [worker-brief.md](worker-brief.md)
- keep the task scope narrow
- ensure the worker owns only the assigned task and its required validation

Workers of one wave share the working tree: their write scopes must be disjoint, and each runs only its own task's validation, not the whole suite.

## Step 5: Review and validate the wave

After the workers return:

1. review each task per the delegation task loop (step 4): diff, unchanged RED test, your own run of its validation, scope, covered criteria
2. send failed tasks up the escalation ladder; the rest of the wave does not wait on a retry unless it depends on it
3. write each passed task's status, log, and touched files into `PLAN.md`
4. write non-obvious deviations, surprises, and escalations into `IMPLEMENTATION-NOTES.md`
5. once every task in the wave passed or is blocked, run the wider validation the wave allows (for example the full test suite)

Move to the next wave only after the current wave is validated and logged.

## Step 6: Repeat

Re-read the plan state and compute the next set of unblocked tasks.

Continue until:

- all reachable tasks are complete
- or a real blocker remains

## Completion rule

A task is complete only when all of the following are true:

- the worker finished the assigned scope
- acceptance criteria are satisfied, not only partially implemented
- RED -> GREEN evidence exists for testable tasks, or an explicit `reason_not_testable` plus exact alternative verification exists
- validation evidence matches the task contract
- `PLAN.md` reflects the completed status and execution log
- touched files are recorded
- any non-obvious deviations are reflected in `IMPLEMENTATION-NOTES.md`

If any of these are missing, the task is not done yet.

## Error handling

- If the requested task subset cannot be found, report the available task ids.
- If parsing fails, report what was tried and what is ambiguous.
- If a worker result is incomplete or incorrect, climb the escalation ladder in [delegation.md](delegation.md) instead of marking the task complete.
