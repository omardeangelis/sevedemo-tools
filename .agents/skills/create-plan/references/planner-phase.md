# Planner Phase

Use this reference for the `$swarm-plan` phase.

## Spec-folder inputs

`SPEC.md` acceptance criteria are the contract every task traces back to. If the spec folder also contains a `FLOW.md`, read it before designing tasks: it locates those criteria in the user-observable flow. `create-spec` writes it from the `ux-advisor` review of an approved prototype.

- **Map (current format):** Goal · Persona situations · Entry points · Happy path · States · Accessibility · Persona dependencies. Every row cites an acceptance-criterion id.
  - Each cited criterion becomes an explicit task, or an explicit check on an existing task. Do not let the outcome and interruption rows, the task-accessibility fixes or a persona hand-off collapse into the happy-path task.
  - A row with no criterion id is not a requirement; plan nothing for it.
  - Manual checks listed under Accessibility become validation steps (`review_mode: browser` or `mixed`).
- **Older format:** Personas · Happy path · Error paths · Edge cases · Friction notes. Read each error path and edge case against the acceptance criteria: plan the ones a criterion covers, and record the rest as assumptions to confirm in the grill phase, not as silent scope.
- **Order:** the flow's sequence and any friction note shape `depends_on` (for example, the empty state before polish, error recovery before animation). Encode them as ordering or task scope, not as free-floating prose.
- **Open questions** still unresolved in `SPEC.md` are planning ambiguities: resolve them in the grill phase or record them as explicit assumptions in the plan.

## Research before task design

Use your code-search tool (or Context7 for library docs / web search) when source context from installed or external packages matters.

Use web search when your code-search tool (or Context7 for library docs / web search) is insufficient or when current API behavior matters.

Prefer primary sources.

## Planner behavior

Produce exactly one named `PLAN.md` in the target spec folder.

Preserve `$swarm-plan` behavior:

- explicit task ids and `depends_on`
- atomic tasks sized for one worker
- validations per task
- a `complexity` rating per task (the executor tier)
- parallel execution waves
- risks and mitigations
- a final subagent review for missing deps, ordering issues, edge cases, and holes before yielding

Do not stop between the grill and planner phases unless a true blocking ambiguity remains.
