# Worker Brief

Use this reference when spawning a worker for one task, in either mode. The worker may be a small model: give it a narrow, complete brief so it does not need to explore.

## Required context

Every brief includes:

- the spec folder path, the task id and name, and the task's goal in one line
- the acceptance criteria the task covers, verbatim from `SPEC.md`
- the relevant `FLOW.md` rows when the task touches a user-facing surface and the spec folder has one: the states, accessibility, and persona-dependency rows that cite those criteria
- the files to create or edit, and the files to read for the pattern to follow
- the RED test (path, run command, and current failing output), or the exact non-testable verification
- the validation commands the worker runs before returning
- constraints that shape the code: project gates from the root `AGENTS.md`, advisor values (for example `design-engineer` easing and durations), and plan-level risks for this task
- what is out of scope, when a neighboring task owns it

Do not send the whole plan, and do not ask the worker to research the codebase: the research is yours.

## Required instructions

Each brief tells the worker to:

1. read the listed files first, and other files only when an import or call it must follow leads there
2. make the RED test pass without editing, weakening, or deleting it or any other test
3. stay inside the listed files; if another file must change, make the smallest change and report why
4. satisfy every listed acceptance criterion, not only the test
5. run the listed validation commands and report their real output
6. not edit `PLAN.md`, `IMPLEMENTATION-NOTES.md`, or tech-debt files, and not commit
7. not run commands that rewrite shared generated state (installs, lockfiles, codegen) unless the brief says so; report the need instead
8. stop and report instead of guessing when the brief and the code disagree

## Worker output contract

The worker returns, briefly:

- files created or modified
- a summary of the change
- each validation command run, with its pass/fail result and the relevant output lines
- deviations from the brief, assumptions made, and anything blocked or risky

## Scope rule

The worker owns one task's code and its local validation. The supervising `implement-spec` run owns the contract (RED test), the review, the fix proposals, escalation, wave construction, and every write to the plan, the notes, and the tech-debt ledger.
