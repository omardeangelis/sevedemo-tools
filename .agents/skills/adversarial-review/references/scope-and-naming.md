# Scope & Naming

Use this reference first. Nothing downstream is valid until the change set and the output folder are resolved.

## Step 1 — Decide the case

- **Case B — spec implementation review** when a spec folder resolves under `brain/specs/<domain>/<spec>/` and the change implements it. Signals: the user names a spec, points at a spec folder, or this run follows `implement-spec`. An `IMPLEMENTATION-NOTES.md` in the spec folder is a strong tell.
- **Case A — standalone review** otherwise. The target is generic code with no governing spec: a branch, a PR, a path glob, or the working tree.

If ambiguous, prefer the explicit signal (a resolvable spec folder → B). State the chosen case in the conversation before continuing.

## Step 2 — Gather the change set (the artifact)

The "artifact" is the concrete set of changes the verifiers will judge. Resolve it explicitly from git/PR state — never run verifiers against an undefined scope, and never assume the diff.

Resolution order (use the first that applies to the user's intent):

1. **Explicit PR** — the PR diff plus the changed-file list (e.g. `gh pr diff <number>` and `gh pr view <number> --json files`, or the equivalent for the host in use).
2. **Branch** — diff the current branch against its merge base with the repository's integration branch. Discover the base branch from repo state rather than hardcoding it: check the project's `AGENTS.md` / contributing docs for the PR base, fall back to the default branch (`git remote show origin` or `git symbolic-ref refs/remotes/origin/HEAD`). Then `git merge-base HEAD <base>`, `git diff <merge-base>...HEAD --stat`, and the full patch.
3. **Working tree** — `git diff` / `git diff --staged` when reviewing uncommitted local work.
4. **Path glob / explicit files** — when the user scopes the review to specific paths.

Capture, at minimum:
- the unified diff (or per-file diffs for large change sets),
- the changed-file list, mapped to the project's modules/areas where the codebase has a discoverable structure (read the layout from `brain/` domain pages or the repo itself — do not assume a fixed source layout),
- the base ref and head ref you compared, so the review is reproducible.

For **case B**, additionally load the spec working set — these are the acceptance contract:
- `SPEC.md` (mandatory) — acceptance criteria, non-goals, constraints
- `FLOW.md` (if present) — happy path, error paths, edge cases the implementation must satisfy
- `PLAN.md` (if present) — task graph, `tdd_target`s, `review_mode`s
- `IMPLEMENTATION-NOTES.md` (if present) — deviations, surprises, blocked work, acceptance-criteria status

## Step 3 — Resolve the domain

- **Case B** — the domain is the spec's domain (`brain/specs/<domain>/<spec>/`). Reuse it verbatim.
- **Case A** — map the changed files to a brain domain using the project's own structure (the `domains/` map in `brain/`, ownership notes, or the repo's module layout). If the change spans several, pick the primary owner and note the others. If none resolves (config, tooling, cross-cutting), use `_unscoped`.

## Step 4 — Resolve the output folder

- **Case A** → `brain/review/<slug>/`
  - `brain/review/` may not exist yet — create it.
  - `<slug>` is a short kebab-case name describing the target: `auth-token-refresh-hotfix`, `http-client-refactor`.
  - If the target is generic/recurring, prefix with the review date for uniqueness: `2026-06-07-payment-utils`.
- **Case B** → the spec folder itself, `brain/specs/<domain>/<spec>/`
  - The review artifacts live **inside the spec folder**, alongside `SPEC.md` / `PLAN.md` / `FLOW.md` / `IMPLEMENTATION-NOTES.md`. Do not create a parallel `brain/review/...` tree for a spec review.

Each review produces exactly two artifacts in the resolved folder:
- `RUBRIC.md` — the routing rubric from the classifier (Stage 1)
- `REPORT.md` — the consolidated verification report (Stage 2)

## Collision rule

If the target folder already contains a prior `REPORT.md`:

- ask whether to **supersede** (overwrite with a fresh review) or **append** (add a new dated review round to the existing report under a new `## [Round: YYYY-MM-DD]` section).
- Never silently overwrite a prior review verdict.

## Do not

- Run the classifier or verifiers before the change set is concretely resolved.
- Assume a base branch, a source layout, or a diff command — derive them from repo state.
- Invent a spec backlink for a case A review — standalone reviews carry no spec links.
- Place a case B review anywhere other than inside its spec folder.
