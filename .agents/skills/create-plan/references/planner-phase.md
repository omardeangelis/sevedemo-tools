# Planner Phase

Use this reference for the `$swarm-plan` phase.

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
- parallel execution waves
- risks and mitigations
- a final subagent review for missing deps, ordering issues, edge cases, and holes before yielding

Do not stop between the grill and planner phases unless a true blocking ambiguity remains.
