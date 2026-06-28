# Brain Bookkeeping

Use this reference while writing `RUBRIC.md` and `REPORT.md`, and after both exist. Read the repo-root `AGENTS.md` for the project's gates and `brain/AGENTS.md` for the canonical brain schema; this file specializes that schema for review artifacts.

## Where the artifacts live

- **Case B (spec implementation):** both artifacts live INSIDE the spec folder, alongside `SPEC.md` / `PLAN.md` / `FLOW.md`:
  - `brain/specs/<domain>/<spec>/RUBRIC.md`
  - `brain/specs/<domain>/<spec>/REPORT.md`
- **Case A (standalone):** both artifacts live under a self-contained review folder (create `brain/review/` if it does not exist yet):
  - `brain/review/<slug>/RUBRIC.md`
  - `brain/review/<slug>/REPORT.md`

The wikilink prefix follows the location: case B links use the `specs/` prefix, case A links use the `review/` prefix.

## Frontmatter — REPORT.md (the ingest-tracked artifact)

`REPORT.md` is the artifact `docs-maintenance` ingests, so it carries the ingest-tracking header.

```yaml
---
domain: <domain>            # case B: the spec's domain. case A: best-fit domain or _unscoped
type: review
scope: spec | standalone    # case B = spec, case A = standalone
spec: <spec-id or null>     # case B: the spec id/folder name. case A: null
review_target: <PR #N | branch <name> | path glob | "spec implementation">
base_ref: <ref compared from>   # the merge-base / base ref you diffed — keeps the review reproducible
head_ref: <ref compared to>
verdict: ship | do-not-ship
review_impact: low | medium | critical
human_in_loop: true | false
links:
  - "[[specs/<domain>/<spec>/RUBRIC]]"                 # case B: the sibling rubric in the spec folder
  - "[[specs/<domain>/<spec>/SPEC]]"                   # case B only
  - "[[specs/<domain>/<spec>/PLAN]]"                   # case B only, if present
  - "[[specs/<domain>/<spec>/FLOW]]"                   # case B only, if present
  - "[[specs/<domain>/<spec>/IMPLEMENTATION-NOTES]]"   # case B only, if present
  # case A instead uses a single link to the sibling rubric:
  # - "[[review/<slug>/RUBRIC]]"
ingested: false
last_ingested: null
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

- Set `ingested: false` / `last_ingested: null` on creation. **Never set `ingested: true` by hand** — only `docs-maintenance` does, after folding findings into `tech-debt/` and backlinking the domain pages.
- For **case A** standalone reviews, omit the `specs/...` links entirely. The only required link is the sibling `RUBRIC` under `review/<slug>/`.

## Frontmatter — RUBRIC.md (the routing input)

```yaml
---
domain: <domain>
type: review-rubric
scope: spec | standalone
spec: <spec-id or null>
links:
  - "[[specs/<domain>/<spec>/REPORT]]"   # case B: the sibling report in the spec folder
  # case A instead: "[[review/<slug>/REPORT]]"
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

`RUBRIC.md` is the input to verification, not an ingest target, so it does not carry `ingested`/`last_ingested`.

## Wikilink path convention

- case B (artifacts in the spec folder) → `[[specs/<domain>/<spec>/REPORT]]`, `[[specs/<domain>/<spec>/RUBRIC]]`
- case A (artifacts in the review folder) → `[[review/<slug>/REPORT]]`, `[[review/<slug>/RUBRIC]]`

## index.md update

Add a row to the **Reviews** section of `brain/index.md`. If the **Reviews** section does not exist yet, create it.

Case B:

```md
- [[specs/<domain>/<spec>/REPORT|<domain>/<spec>]] — spec · <verdict> · <review_impact> · <YYYY-MM-DD>
```

Case A:

```md
- [[review/<slug>/REPORT|<slug>]] — standalone · <verdict> · <review_impact> · <YYYY-MM-DD>
```

## log.md entry

Append to `brain/log.md` (cap at 50 entries; drop oldest when over):

```md
## [YYYY-MM-DD] review | <review target title>
- Report: [[specs/<domain>/<spec>/REPORT]]   # case A: [[review/<slug>/REPORT]]
- Scope: spec | standalone
- Verdict: SHIP | DO NOT SHIP
- Impact: low | medium | critical
- Verifiers: <count> (<n> blockers, <n> major)
```

## Tech-debt linkage

This skill does **not** write `tech-debt/` — that is `docs-maintenance`'s job during ingest. But make the handoff clean: ensure `REPORT.md` clearly marks which findings are durable (confirmed BLOCKER/MAJOR that won't be fixed before ship) versus fixed-before-merge, so `docs-maintenance` can fold the durable ones into `tech-debt/<domain>/<spec>.md` (case B) or `tech-debt/<best-fit-domain>/<slug>.md` (case A) without re-judging.

## Order of operations

1. Write `RUBRIC.md` (end of Stage 1) with its frontmatter.
2. Write `REPORT.md` (Stage 4) with its frontmatter and the consolidated findings.
3. Update `brain/index.md` Reviews section.
4. Append the `brain/log.md` entry.
5. Do not touch domain `flows/`/`concepts/` or `tech-debt/` — those are downstream of `docs-maintenance`.
