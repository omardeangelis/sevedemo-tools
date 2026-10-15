# Brain Schema

This file defines how any agent operates within `brain/`. Read it before creating or modifying brain content.

> `AGENTS.md` and `CLAUDE.md` in this folder are kept identical on purpose, so any agent (Claude Code, Codex, Cursor, …) discovers the same rules. Edit both when you change one.

## Skill Routing

Primary skills here: `create-spec`, `create-plan`, `implement-spec`, `adversarial-review`, `docs-maintenance`, `grill-me`, `swarm-plan`, `tdd`, `simplify`, `design-engineering`, and `prototype` (explicit invocation only).

- Use `create-spec` to author a `SPEC.md` in the problem space (the *what*, not the *how*).
- Use `create-plan` to turn an approved spec into an execution-ready `PLAN.md`. It wraps `grill-me`, `swarm-plan`, and `tdd` as inner phases.
- Use `implement-spec` to execute an approved spec folder. Choose the execution mode inside the skill: `sequential` or `parallel`.
- Use `docs-maintenance` to ingest a spec folder into the brain domain layer and create missing domain scaffolding when needed.
- `docs-maintenance` owns the full ingest pipeline. It creates or updates the domain map/contract when needed, then writes flow pages first, then concept pages.
- Do not hand-write `domains/<domain>/flows/` or `domains/<domain>/concepts/` pages when that ingest workflow applies.
- `SPEC.md` and `IMPLEMENTATION-NOTES.md` remain the source material, but the ingest orchestrator may update their frontmatter/link bookkeeping (`ingested`, `last_ingested`, backlinks) as part of the pipeline.
- Use `adversarial-review` as an independent, bias-free quality gate on a code change or spec implementation: it classifies the change (`review-classifier`) then fans out independent `adversarial-verifier` passes and writes a SHIP / DO-NOT-SHIP `REPORT.md`.
- Use `prototype` — **explicit invocation only**, never auto-routed — to explore N genuinely different variants of one UI piece behind a visual picker. When the user approves a winner, `prototype` has `ux-advisor` and `ui-reviewer` review it in the browser, in parallel (the only point in the flow that spawns them), then hands the winner and both reviews to `create-spec`. The winner is never integrated by hand, and the prototype surface is deleted once `implement-spec` lands the real implementation.
- `design-engineering` is the motion-craft reference: it loads on its own whenever motion is written, reviewed, or fixed (standards with exact values, gestures, scroll, reduced motion, performance) and holds the review, audit, opportunities, diagnosis, and motion-brief procedures. Advisory motion work goes through the `design-engineer` agent, which routes to it. Its code examples are React; `chore/motion-stack.md` (written by its stack-adaptation procedure, at init or on first use) maps them to the project's own stack. Record project-specific motion decisions in `chore/` (e.g. `chore/motion.md`), not by editing the skill.

### Advisor subagents

Shipped advisor subagents live in `.agents/agents/` (symlinked into each capable provider, e.g. `.claude/agents/`). The spec-driven skills spawn them so reasoning is verified **without consuming the orchestrator's context**:

- `ux-advisor` — reviews the UX of an approved, rendered UI for the people who will use it (whether everyone can finish the task, keyboard and screen-reader users included; every outcome the real system can return; leaving and interrupting mid-task; the copy; persona situations; what is already broken around it) and returns a few ranked decisions, each backed by observed evidence. Static UI goes to `ui-reviewer`, motion and interaction craft to `design-engineer`. Spawned only by `prototype` after the user approves a winner, or on explicit request for a live surface; it writes no files — `create-spec` turns its review into acceptance criteria and a `FLOW.md` map.
- `ui-reviewer` — reviews the static UI of an approved, rendered UI (placement and geometry, widths and wrapping, contrast, focus-indicator visibility, target size and hit area, accessible-name markup, browser and device rendering). It measures in the browser with the tested probes of its companion skill `ui-review`, names the engine behind every finding, and returns a few ranked decisions, each backed by a measurement or an opened screenshot. Spawned only by `prototype`, in parallel with `ux-advisor`, after the user approves a winner, or on explicit request for a live surface; it writes no files — `create-spec` turns its review into acceptance criteria, one criterion where both reviewers name the same element. The UI pass of `adversarial-review` runs the same skill without spawning it.
- `adversarial-verifier` — clean-context quality gate that builds the strongest case against an artifact (spec, plan, or diff) and returns SHIP / DO NOT SHIP.
- `review-classifier` — routes the `adversarial-review` pipeline (how many verifier passes, at what depth).
- `design-engineer` — motion / interaction-craft advisor: motion budget and exact values (easing, durations, springs, reduced motion) in `create-plan`, pre-task motion decisions in `implement-spec`, the motion-craft bar for an `adversarial-review` verifier pass, and read-only motion audits written to `chore/animation-plans/`. Routes every mode to the shipped `design-engineering` skill (project tokens and documented motion decisions in `chore/` win over it), with a built-in baseline as fallback.

> **No subagent runtime?** Most non-Claude tools cannot spawn subagents yet. When that is your case, do **not** skip the advisor steps — run the named advisor's charter (`.agents/agents/<name>.md`) inline in your main context: you lose the clean-context isolation but keep the same rubric and the same checks. Skipping is only for when the advisor file is not installed at all.

## Spec-Driven Rules

Non-negotiables every spec-driven skill respects:

- Specs live in the problem space — the *what* and *why*, never the *how*.
- One `SPEC.md` maps to one capability/epic; when child stories exist, their requirements are unified beneath it.
- No code is written during `create-spec` or `create-plan`. Implementation happens only in `implement-spec`.
- Tests describe behavior through public interfaces (see `tdd`). No horizontal slicing (all-tests-then-all-code).
- Persistent implementation drift is tracked in `<techDebt>/<domain>/<spec>.md` (see Project configuration), not buried in spec folders.
- Domain knowledge in `domains/` is written by `docs-maintenance`, not hand-authored.

> Project-specific gates (build/test/lint commands, contract/codegen chains, conventions) live in the repo-root `AGENTS.md` (fallback: `CLAUDE.md` when no `AGENTS.md` exists), not here — that is the file every AI tool reads. The review policy lives in the project config below.

## Project configuration

The project's own facts, and its policy knobs, live in `brain/brain.config.json`. It is project-owned: `brain init` writes it from what it detects, `brain upgrade` only adds keys that are missing, `brain doctor` validates it, and `brain config get|set` reads and changes it.

**Read it first.** Every suite skill and shipped agent reads `brain/brain.config.json` at the start of a run. When the file is absent, every default below applies.

**Never edit an installed skill or agent to fit the project.** Change the config, or the project-owned file it points to. The bundled files stay identical to the package, so `brain upgrade` never conflicts.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `review.mode` | `total` \| `plan` \| `none` | `total` | Which clean-context reviews the flows start on their own (matrix below) |
| `review.location` | `spec-folder` \| `review-tree` | `spec-folder` | Where a spec's review lands (see `review/` below) |
| `paths.techDebt` | repo-relative directory | `brain/tech-debt` | The tech-debt store, one page per spec |
| `paths.reviews` | repo-relative directory | `brain/review` | Standalone reviews, and spec reviews under `review-tree` |
| `paths.personas` | repo-relative file, or `null` | `null` | The project's personas page |
| `execution.delegation` | `supervised` \| `inline` | `supervised` | Who writes each task's code in `implement-spec` (below) |

**Path tokens.** Skills and agents write `<techDebt>`, `<reviews>` and `<personas>` for the resolved `paths.techDebt`, `paths.reviews` and `paths.personas`. With the defaults, `<techDebt>/<domain>/<spec>.md` is `brain/tech-debt/<domain>/<spec>.md`.

**A spec's review folder** is `brain/specs/<domain>/<spec>/` under `review.location: spec-folder`, and `<reviews>/<domain>/<spec>/` under `review-tree`.

### Review modes

`review.mode` decides which clean-context reviews the flows start **on their own**. Explicit invocation (`/adversarial-review`, or asking for a verifier pass) works in every mode.

| Gate | `total` | `plan` | `none` |
|---|---|---|---|
| `create-spec`: `adversarial-verifier` on `SPEC.md` | runs; BLOCKERs fixed before save | not run (self-check against the quality bar only) | not run |
| `create-plan`: `adversarial-verifier` on `PLAN.md` | runs; BLOCKERs folded in before stop | runs | not run; offered in one line |
| `implement-spec`: `adversarial-review` before the acceptance audit | runs; BLOCKERs resolved before finalizing | not run; offered in one line | not run; offered in one line |
| A `PLAN.md` task that lists review as a closing step | executed | offered, not run | offered, not run |
| Motion-craft verifier pass | whenever a review runs | same | same |
| UI verifier pass | whenever a review runs | same | same |

- `total` reviews the spec, the plan and the code. It is the default.
- `plan` moves every mandatory review onto the plan: decisions are checked before code exists, and the code is reviewed only on request.
- `none` makes every gate opt-in.

Skills mark each gate with **Gate — `review.mode` ∈ {…}**. In a mode outside the set, the skill offers the review in one line and continues.

### Execution delegation

`execution.delegation` decides who writes each task's code in `implement-spec`, in both execution modes (`sequential` runs one task at a time, `parallel` runs waves; delegation is independent of that choice).

- `supervised` (default): the orchestrator supervises. It writes each task's RED test, hands the task to one worker on the model tier the task's `complexity` names (`low` → fast, `medium` → balanced, `high` → strongest), reviews the result itself, and sends back a concrete fix when it fails. After two failed reviews, a worker one tier up takes the task; after that, the orchestrator does it or reports a blocker. Only the orchestrator writes `PLAN.md`, `IMPLEMENTATION-NOTES.md` and tech debt.
- `inline`: the orchestrator writes the code of `sequential` tasks itself, and `parallel` workers inherit its model.

`create-plan` (through `swarm-plan`) rates every task's `complexity` when it writes the plan.

## Directory Conventions

### `raw/` — Immutable Sources

Human-authored source material. Agent reads but **never edits**.

- `meetings/` — meeting notes, transcripts
- `external/` — external docs, reference material
- `assets/` — binary files, images, PDFs

### `specs/` — Feature Specifications

PM-authored specifications organized by domain. Agents should treat their product intent as source material and should not rewrite requirements casually, but the ingest orchestrator may update frontmatter/link bookkeeping when processing them into domain knowledge.

- `specs/<domain>/<domain>-specs.md` — domain spec page map (entry point for discovery)
- `specs/<domain>/<spec-name>/SPEC.md` — individual spec file
- `specs/<domain>/<spec-name>/FLOW.md` — optional flow **map** (Goal · Persona situations · Entry points · Happy path · States · Accessibility · Persona dependencies). `create-spec` writes it only when the spec starts from an approved prototype reviewed by `ux-advisor`. Every requirement in it cites a `SPEC.md` acceptance criterion: `SPEC.md` is the only acceptance contract, and a requirement stated only in `FLOW.md` is a defect. Older files with Personas · Error paths · Edge cases sections are still read. Consumed by `create-plan`, `implement-spec`, and `docs-maintenance`
- `specs/<domain>/<spec-name>/PLAN.md` — optional implementation plan for that spec
- `specs/<domain>/<spec-name>/IMPLEMENTATION-NOTES.md` — run-local reviewer context for that spec implementation; carries its own frontmatter and `ingested` tracking
- `specs/<domain>/<spec-name>/RUBRIC.md` + `REPORT.md` — optional `adversarial-review` artifacts (routing rubric + SHIP/DO-NOT-SHIP verdict) for that spec implementation, under `review.location: spec-folder`

### `review/` (`<reviews>`) — Review Artifacts

`adversarial-review` outputs. One folder per review, holding `RUBRIC.md` (routing rubric) and `REPORT.md` (SHIP / DO-NOT-SHIP verdict).

- **Standalone review** (case A, code not tied to a spec): always `<reviews>/<slug>/`.
- **Spec-implementation review** (case B): in the spec's review folder, per `review.location`:
  - `spec-folder` → `specs/<domain>/<spec>/`, next to `SPEC.md`;
  - `review-tree` → `<reviews>/<domain>/<spec>/`, mirroring the spec path.

`docs-maintenance` ingests each `REPORT.md`: it folds the durable findings into `<techDebt>/<domain>/<spec>.md` (case B) and marks the report `ingested: true`.

### `personas.md` (`<personas>`) — Project Personas

Optional, project-owned. `brain/personas.md` (`domain: _root`, `type: personas`) holds the people the product serves, one `##` per persona, written by the project or extracted verbatim from an agent or router at init. `paths.personas` points to it, or to the project's existing persona file wherever it lives.

`ux-advisor`, `create-spec` and `prototype` read `<personas>`. When `paths.personas` is `null`, they characterize users generically and record the gap as an open question.

### `chore/` — Informal Planning Material

Repo-level planning scratch. Allowed to be informal. Promote durable decisions into `domains/<domain>/decisions/`.

- e.g. `tech-stack.md`, product description, user stories, implementation backlog
- `motion-stack.md` — the frontend stack and its translation of the `design-engineering` references' React APIs (regenerate when the stack changes; never hand-patch)
- `animation-plans/` — prioritized motion audit plans written by the `design-engineer` agent (read-only on source; promote large findings to `create-spec`)
- `motion.md` — the project's motion decisions, which win over the `design-engineering` references
- `ux-review.md` — optional calibration for `ux-advisor`, read before every review, in three parts:
  - **Component traps** of the stack (for example, a library primitive that swallows keys);
  - **Kept examples** of findings that changed the product;
  - **Suppressed findings**: findings the project rejected, each with the reason, so they do not come back. `create-spec` offers to append one whenever the user rejects a UX finding.
- `ui-review.md` — optional project knowledge for `ui-reviewer` and the UI pass of `adversarial-review`, read before every UI review, in four parts:
  - **Project bar**: the minimum width, the target-size standard, the engines and devices the project supports, and any design-system rule the review enforces. The user writes it; without it the reviewer's defaults apply;
  - **Component traps** of the project's components;
  - **Kept examples** of findings that changed the product;
  - **Suppressed findings**: UI findings the project rejected, each with the reason. `create-spec` creates the page on the first one, and init-brain when it routes a project's own UI-review knowledge; both leave the Project bar to the user.

### `domains/<name>/` — Synthesized Domain Knowledge

Agent-owned synthesis layer. This is where the LLM writes.

- `<domain>.md` — domain page map. Updated on every ingest or page creation. The stable entry point skills read to discover what exists. Named after the domain so it is identifiable in graph view (e.g. `patients.md`, `auth.md`).
- `<domain>-contract.md` — domain boundaries, invariants, ownership, what it does NOT do. Three sections: **Owns**, **Does Not Own**, **Invariants**. Named with domain prefix for graph readability (e.g. `patients-contract.md`).
- `concepts/` — one page per core concept
- `flows/` — step-by-step user or system flows
- `decisions/` — domain-level ADRs

## Frontmatter Schema

### Base (all brain pages)

```yaml
---
domain: auth | user-management | documents
type: concept | flow | decision | contract | index | spec | implementation-notes | personas
links: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

### Spec-only addition

```yaml
status: draft | review | approved | implemented
```

`status` is required when `type: spec`, omitted for all others.

### Domain pages (concepts, flows, decisions, contracts)

```yaml
ingested: true | false
last_ingested: YYYY-MM-DD | null
```

Tracks whether the LLM has processed the page. Enables staleness queries.

### Implementation notes (`type: implementation-notes`)

```yaml
---
domain: <domain>
type: implementation-notes
spec: <spec-id> # e.g. CP-120
links:
  - "[[specs/<domain>/<spec>/SPEC]]" # always: own spec
  - "[[domains/<domain>/flows/<flow>]]" # added after each flow is written
  - "[[domains/<domain>/concepts/<concept>]]" # added after each concept is written
ingested: true | false
last_ingested: YYYY-MM-DD | null
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

`ingested: true` means the notes were processed by `docs-maintenance` and their deviations/surprises are reflected in the domain flow and concept pages. Set only by the ingest orchestrator — never by hand.

### Raw files

```yaml
ingested: true | false
last_ingested: YYYY-MM-DD | null
```

## Ingest Workflow

When processing source material into domain knowledge:

1. Read source fully
2. Identify which domains it touches
3. For each domain: update `<domain>.md`, update or create flow pages first, then concept pages
4. Flag contradictions with `> [!warning] CONTRADICTS [[page]]`
5. Append entry to `log.md` (cap at 50 entries — drop oldest if over)
6. Update root `index.md` if new pages created
7. Set `ingested: true` and `last_ingested` on processed source and created/updated pages, including `IMPLEMENTATION-NOTES.md` when present

## Cross-Domain Linking Rules

- Use `[[wikilinks]]` freely between domains
- A concept in one domain should link to related concepts in other domains
- Backlinks from domain pages to source specs: `[[specs/domain/spec-name]]`

## Lint Rules

- Orphan pages (no inbound links) = knowledge gaps
- Pages without frontmatter = malformed
- Stale pages (not updated in 30+ days after related ingest) = review needed
- Contradictions flagged but unresolved = action items

## Relationship to the tech-debt store (`<techDebt>`)

- `<techDebt>/<domain>/<spec>.md` owns persistent implementation drift tied to one spec; keep temporary execution notes in the spec folder instead
- Durable review findings reach it through `docs-maintenance` (review ingest), never by hand-copying a `REPORT.md`
