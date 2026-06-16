# Brain Schema

This file defines how any agent operates within `brain/`. Read it before creating or modifying brain content.

> `AGENTS.md` and `CLAUDE.md` in this folder are kept identical on purpose, so any agent (Claude Code, Codex, Cursor, …) discovers the same rules. Edit both when you change one.

## Skill Routing

Primary skills here: `create-spec`, `create-plan`, `implement-spec`, `adversarial-review`, `docs-maintenance`, `grill-me`, `swarm-plan`, `tdd`, `simplify`.

- Use `create-spec` to author a `SPEC.md` in the problem space (the *what*, not the *how*).
- Use `create-plan` to turn an approved spec into an execution-ready `PLAN.md`. It wraps `grill-me`, `swarm-plan`, and `tdd` as inner phases.
- Use `implement-spec` to execute an approved spec folder. Choose the execution mode inside the skill: `sequential` or `parallel`.
- Use `docs-maintenance` to ingest a spec folder into the brain domain layer and create missing domain scaffolding when needed.
- `docs-maintenance` owns the full ingest pipeline. It creates or updates the domain map/contract when needed, then writes flow pages first, then concept pages.
- Do not hand-write `domains/<domain>/flows/` or `domains/<domain>/concepts/` pages when that ingest workflow applies.
- `SPEC.md` and `IMPLEMENTATION-NOTES.md` remain the source material, but the ingest orchestrator may update their frontmatter/link bookkeeping (`ingested`, `last_ingested`, backlinks) as part of the pipeline.
- Use `adversarial-review` as an independent, bias-free quality gate on a code change or spec implementation: it classifies the change (`review-classifier`) then fans out independent `adversarial-verifier` passes and writes a SHIP / DO-NOT-SHIP `REPORT.md`.

### Advisor subagents

Shipped advisor subagents live in `.agents/agents/` (symlinked into each capable provider, e.g. `.claude/agents/`). The spec-driven skills spawn them so reasoning is verified **without consuming the orchestrator's context**:

- `ux-advisor` — writes a spec's `FLOW.md` (user-flow contract) and pressure-tests implementation order.
- `adversarial-verifier` — clean-context quality gate that builds the strongest case against an artifact (spec, plan, or diff) and returns SHIP / DO NOT SHIP.
- `review-classifier` — routes the `adversarial-review` pipeline (how many verifier passes, at what depth).

> **No subagent runtime?** Most non-Claude tools cannot spawn subagents yet. When that is your case, do **not** skip the advisor steps — run the named advisor's charter (`.agents/agents/<name>.md`) inline in your main context: you lose the clean-context isolation but keep the same rubric and the same checks. Skipping is only for when the advisor file is not installed at all.

## Spec-Driven Rules

Non-negotiables every spec-driven skill respects:

- Specs live in the problem space — the *what* and *why*, never the *how*.
- One `SPEC.md` maps to one capability/epic; when child stories exist, their requirements are unified beneath it.
- No code is written during `create-spec` or `create-plan`. Implementation happens only in `implement-spec`.
- Tests describe behavior through public interfaces (see `tdd`). No horizontal slicing (all-tests-then-all-code).
- Persistent implementation drift is tracked in `tech-debt/<domain>/<spec>.md`, not buried in spec folders.
- Domain knowledge in `domains/` is written by `docs-maintenance`, not hand-authored.

> Project-specific gates (build/test/lint commands, review gates, contract/codegen chains) live in the repo-root `AGENTS.md`, not here — that is the file every AI tool reads.

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
- `specs/<domain>/<spec-name>/FLOW.md` — optional user-flow contract (Goal · Personas · Entry points · Happy path · Error paths · Edge cases), written by the `ux-advisor` agent during `create-spec`; consumed by `create-plan`, `implement-spec`, and `docs-maintenance`
- `specs/<domain>/<spec-name>/PLAN.md` — optional implementation plan for that spec
- `specs/<domain>/<spec-name>/IMPLEMENTATION-NOTES.md` — run-local reviewer context for that spec implementation; carries its own frontmatter and `ingested` tracking
- `specs/<domain>/<spec-name>/RUBRIC.md` + `REPORT.md` — optional `adversarial-review` artifacts (routing rubric + SHIP/DO-NOT-SHIP verdict) for that spec implementation

### `review/` — Standalone Review Artifacts

`adversarial-review` outputs for code **not** tied to a spec (case A). One folder per review; spec-implementation reviews live inside the spec folder instead.

- `review/<slug>/RUBRIC.md` + `REPORT.md` — routing rubric + SHIP/DO-NOT-SHIP verdict for a standalone diff/branch/PR

### `chore/` — Informal Planning Material

Repo-level planning scratch. Allowed to be informal. Promote durable decisions into `domains/<domain>/decisions/`.

- e.g. `tech-stack.md`, product description, user stories, implementation backlog

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
type: concept | flow | decision | contract | index | spec | implementation-notes
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

## Relationship to `tech-debt/`

- `tech-debt/<domain>/<spec>.md` owns persistent implementation drift tied to one spec; keep temporary execution notes in the spec folder instead
