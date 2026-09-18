# Implement Spec Lifecycle

## Shared contract

`implement-spec` is the only public execution entrypoint.

It routes to one of two approaches:

- `sequential` — one thread, no workers
- `parallel` — wave-based execution with explicit worker orchestration

Do not recreate wrapper skills for these modes. Keep the routing here and load only the needed mode reference.

## 1. Require an existing reviewed spec folder

Execution must stay grounded in:

`brain/specs/<domain>/<spec>/`

Required files:

- `SPEC.md`
- `PLAN.md`

If `SPEC.md` is missing, stop and report the resolved path error.

If `PLAN.md` is missing, stop and use `create-plan`. Do not auto-generate plans from this skill.

## 2. Resolve the target folder

Accept either:

- a domain plus spec folder name
- a full spec folder path
- a direct `SPEC.md` or `PLAN.md` path

Normalize to the containing spec folder before doing any work.

## 3. Load the working set

Read, in this order:

1. `brain/AGENTS.md`
2. `brain/specs/<domain>/<spec>/SPEC.md`
3. `brain/specs/<domain>/<spec>/PLAN.md`
4. `brain/specs/<domain>/<spec>/IMPLEMENTATION-NOTES.md` if present

If package or framework behavior matters, inspect source with your code-search tool (or Context7 for library docs / web search) before guessing.

## 4. Prepare execution notes

Use [../assets/IMPLEMENTATION-NOTES-TEMPLATE.md](../assets/IMPLEMENTATION-NOTES-TEMPLATE.md).

- Create `IMPLEMENTATION-NOTES.md` from the template when missing.
- Append or refine when it already exists.
- Keep it current during the run, not only at the end.

## 5. Prepare the tech-debt ledger

Persistent implementation drift belongs inside brain, in:

`brain/tech-debt/<domain>/<spec>.md`

Use it only for durable drift that should inform later work on the same spec:

- scoped compromises
- unresolved gaps
- pre-existing debt discovered during execution
- cleanup intentionally deferred by the current spec

Do not create the file when nothing durable must survive the run.

## 6. Advisor agent triggers (pre-task)

Before starting any task whose `location` matches a project advisor trigger, delegate to the advisor agent first. The advisors do not write code — they shape the approach before the task runs.

If this project defines advisor agents (see `## Project Advisors`), delegate to the matching one before starting a task whose location it owns:

- **the data/schema layer** → invoke a project advisor agent (see the skill's `## Project Advisors` section, populated by init-brain) via the `Agent` tool. Brief it with the task description, the proposed schema change, and any relevant SPEC excerpt. Apply its recommendations (column types, nullability, FK cascades, index coverage, migration reversibility) before writing the RED test for that task.

User-facing surfaces have no pre-task UX advisor: tasks implement `FLOW.md` (error/edge paths included) as written, and the `ux-advisor` judges the result on the running screens after implementation (§12). UX friction found mid-task goes to `IMPLEMENTATION-NOTES.md` as an input for that walkthrough.

Skipping an advisor when its trigger fires must be justified in the conversation (e.g., "schema change is a trivial NOT NULL → NULL flip, advisor pass skipped"). Silent skips are not allowed.

## 7. Shared execution invariants

- Mode is manual. The chosen approach decides the execution path.
- Do not switch modes mid-run unless the user explicitly redirects.
- Treat every `tdd_target` as required RED-first behavior, never optional guidance.
- Treat every `review_mode` as required validation routing, never optional metadata.
- Keep an operator-visible execution board in the conversation so progress is obvious.
- Keep scope discipline. Out-of-scope findings go to `IMPLEMENTATION-NOTES.md`, not silent scope creep.
- If backlog sync is part of the run, keep epic and story bodies product-facing.
- Execution-time backlog sync may use comments, links, native status, and native relations.
- Never rewrite epic or story bodies with task ids, TDD targets, validation commands, or file lists.

## 8. Shared upkeep after each completed unit

After each completed task or wave:

- update `PLAN.md` status
- append a concise execution log in `PLAN.md`
- record touched files in `PLAN.md`
- update `IMPLEMENTATION-NOTES.md` with non-obvious decisions, surprises, or deviations
- update the spec-linked tech-debt file when durable drift appears
- if backlog sync is in scope, prefer native metadata changes or concise comments over body rewrites

## 9. Handle blockers honestly

If a task is blocked:

1. record it in `IMPLEMENTATION-NOTES.md`
2. update the spec-linked tech-debt file when the blocker is durable
3. skip only tasks truly blocked by it
4. finish all remaining reachable work
5. report blocked tasks clearly at the end

Do not fake completion.

## 10. Apply runtime-aware validation

Use the task `review_mode`:

- `cli`: tests, commands, type-checks, API calls, or non-visual checks
- `browser`: browser validation through `$agent-browser` (or another browser-driving tool if unavailable)
- `mixed`: both

If running inside a worktree and `portless` is available, prefer it for server-based validation to avoid port conflicts.

## 11. Verify acceptance criteria

Re-read `SPEC.md` acceptance criteria and mark each one:

- met
- unmet
- blocked

Record a reason for every unmet or blocked item in `IMPLEMENTATION-NOTES.md`.

## 12. Post-implementation UX walkthrough

Run it once all reachable tasks are done and the acceptance audit is recorded, when the spec has a user-facing surface (a `FLOW.md`, or acceptance criteria that map to screens). For specs with no UI, skip it and say so.

1. Start the app the way the root `AGENTS.md` prescribes for browser validation: fake/preview backends and scratch data only, never paid services or real data. Note the URL, how to seed/reset data and how to trigger failures.
2. Spawn the `ux-advisor` agent in walkthrough mode with a self-contained brief: spec folder path, `FLOW.md`, app URL, seed/reset/failure triggers, a dedicated browser session name, a scratch directory for screenshots, relevant `IMPLEMENTATION-NOTES.md` friction notes, and the rule that it does not start/stop servers or edit code, `FLOW.md` or `PLAN.md`.
3. The advisor walks happy, error and edge paths on the real screens, looks at its screenshots, and writes `brain/specs/<domain>/<spec>/UX-REVIEW.md`: findings ranked by user impact vs. effort (each with the `FLOW.md` step, the screen evidence and the proposed change), proposed `FLOW.md` edits, and open questions. If `UX-REVIEW.md` already exists, it appends a new dated round instead of overwriting.
4. Stop every server and browser session you started, by PID.
5. Do not apply the proposals in this run. Summarize them for the user and list `UX-REVIEW.md` under **Remaining work** in `IMPLEMENTATION-NOTES.md` as awaiting a decision. Accepted proposals become `FLOW.md` changes plus new `PLAN.md` tasks, executed by a new `implement-spec` run.

If the app cannot be started, say so: never pass off a code-reading critique as a walkthrough of the screens.

## 13. Finalize the spec folder

Before reporting back:

- remove empty sections from `IMPLEMENTATION-NOTES.md`
- ensure **Execution mode** reflects the mode actually used
- ensure **Sanity checks** lists only commands actually run
- ensure **Remaining work** matches any unmet or blocked criteria
- set `SPEC.md` frontmatter `status: implemented`
- set `PLAN.md` `**Status:** Complete` when that line exists

## 14. Final report shape

Summarize:

- implementation status
- validation results
- key deviations or surprises
- acceptance-criteria status
- blocked tasks needing input
- whether the spec-linked tech-debt file was created or updated
- the UX walkthrough outcome: where `UX-REVIEW.md` is and its most important findings (or why it was skipped)
- the next steps, in order: decide on `UX-REVIEW.md` → product revisions through new `implement-spec` runs → once the product is frozen, `adversarial-review` in a **new session** → `docs-maintenance` after a SHIP verdict

## 15. Session boundary: no adversarial review here

`adversarial-review` is the independent quality gate, but it never runs in the session that implemented the spec:

- its verdict covers only the exact change set it reviewed, so any later product revision or fix invalidates it, and right after a first implementation is when revisions are most likely
- the implementing session carries the author's context, the opposite of the clean start a bias-free check needs

So:

- never invoke `adversarial-review` from this skill, not even as a closing step; if the user asks for it in this session, explain the rule and propose a fresh session
- the user runs it in a new session once the product is frozen (revisions and accepted `UX-REVIEW.md` proposals done)
- fixing its findings is a new implementation run, and the re-review is again a new session
