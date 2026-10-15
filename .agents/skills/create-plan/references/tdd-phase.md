# TDD Phase

Use this reference for the `$tdd` shaping phase across execution tasks.

## TDD shaping rules

Preserve `$tdd` behavior:

- surface the public interface change and the behavior priority behind the task
- identify deep-module or testability opportunities while task boundaries are still fluid
- define the first public-interface behavior that should fail before implementation
- prefer integration-style behavior through public interfaces
- avoid implementation-detail or private-method testing
- avoid horizontal slicing; every task should represent a RED -> GREEN tracer bullet
- make the first failing test concrete enough that a worker can start without guessing
- do not leave TDD intent implicit or hidden outside the saved plan artifact

## Execution metadata

`tdd_target` must name one public behavior to prove first.

`review_mode` must be:

- `cli` for tests, commands, APIs, or non-visual validation
- `browser` for interactive UI validation via `$agent-browser`
- `mixed` when both are required

`complexity` must be `low`, `medium`, or `high`, rated with the `$swarm-plan` rubric (Task complexity). Confirm or raise it once `tdd_target` is set: a task whose first failing test pins the behavior completely can stay `low`; a task whose target still leaves design choices to the implementer cannot. `implement-spec` uses it to pick the model tier of the worker that executes the task.
