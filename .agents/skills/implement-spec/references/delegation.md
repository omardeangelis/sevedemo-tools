# Delegation

Use this reference to decide who writes each task's code and how that work is reviewed. It applies to both execution modes: the mode decides how many tasks run at once, delegation decides who executes each one.

## Resolve the policy

Read `execution.delegation` from `brain/brain.config.json` (default `supervised`):

- `supervised` — you are the supervisor. Every task goes to one worker on the model tier its `complexity` names. You prepare the contract, review the result, propose fixes, and escalate. You do not write production code while the ladder below still has a rung.
- `inline` — the 0.7 behavior. `sequential` runs without workers. `parallel` still runs the review loop below, but every worker inherits your model and the escalation rung is you.

If your runtime cannot spawn subagents, run `inline` and say so under **Execution mode** in `IMPLEMENTATION-NOTES.md`.

## Model tier

Map each task's `complexity` to a tier when spawning its worker. Use the concrete model your runtime exposes for the tier (in Claude Code, the `Agent` tool's `model` option):

| `complexity` | Tier | Claude Code `model` |
|---|---|---|
| `low` | fast / cheap | `haiku` |
| `medium` | balanced | `sonnet` |
| `high` | strongest | omit (inherit yours) |

- A task without `complexity` (a plan older than the field): rate it with the `$swarm-plan` rubric (Task complexity) before spawning, and write the rating into its `PLAN.md` entry.
- You may move a task up or down one tier when what you learned while preparing it contradicts the plan. Log the change and the reason in the task's `PLAN.md` log.

## Task loop

For every task, in the order the mode dictates:

1. **Prepare the contract.** Run the pre-task advisor triggers (lifecycle §6). Read enough of the task's files to brief precisely. Write the RED test from `tdd_target` and run it: it must fail, and for the reason the task exists. For a non-testable task, write the exact alternative verification instead. In `parallel` mode, prepare every task of the wave before spawning any worker.
2. **Brief.** Build the brief from [worker-brief.md](worker-brief.md).
3. **Spawn one worker** on the task's tier.
4. **Review.** Do not take the worker's report on trust:
   - read the diff of the task's files
   - confirm the RED test is unchanged and now passes
   - run the task's validation yourself; for `review_mode: browser` or `mixed`, the browser validation is yours (lifecycle §10)
   - confirm nothing outside the task's files changed without a reported reason
   - check the acceptance criteria the task covers, not only the test
5. **Pass:** run the shared upkeep (lifecycle §8). Only you write `PLAN.md`, `IMPLEMENTATION-NOTES.md`, and the tech-debt file.
6. **Fail:** climb the ladder.

A trivial defect (a missing import, a typo, a one-line off-by-one) you may fix yourself and count the review as passed. Log it.

## Escalation ladder

A review fails when the validation fails, the RED test was weakened, the scope was broken, or a covered criterion is unmet.

| Attempt | Who | What it receives |
|---|---|---|
| 1 | a worker on the planned tier | the brief |
| 2 | the same worker, continued (in Claude Code: `SendMessage` to its id) | your fix proposal |
| 3 | a new worker one tier up: `low` → `medium`, `medium` → `high` | the brief, both failures, both fix proposals, and the current diff |
| 4 | you, inline — or a blocker | everything above |

For a `high` task, attempt 3 is you, inline. If attempt 4 also fails, the task is blocked: handle it per lifecycle §9.

**A fix proposal is concrete:** the failing command and the relevant lines of its output, the file and line at fault, and the change to make. "The test fails, please fix it" is not a proposal.

Before attempt 3, decide whether the current diff is a useful starting point. If it is not, restore the task's files (only those — other workers may be mid-task) and say so in the brief.

If your runtime cannot continue an agent, attempt 2 is a new worker on the same tier, given the brief, the current diff, and the fix proposal.

## Record

Under **Execution mode** in `IMPLEMENTATION-NOTES.md`, record the delegation policy and every escalation: task id, the tier it ended on, and one line on why the lower tier failed. Repeated escalations of one kind of task are a signal for the next plan's ratings.
