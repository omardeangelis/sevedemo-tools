# Brain Bookkeeping

Use this reference while writing `RUBRIC.md` and `REPORT.md`, and after both exist. Read the repo-root `AGENTS.md` (fallback: `CLAUDE.md`) for the project's gates, `brain/AGENTS.md` for the canonical brain schema, and `brain/brain.config.json` for the paths (absent → the defaults in `brain/AGENTS.md` → Project configuration); this file specializes that schema for review artifacts.

## Where the artifacts live

- **Case B (spec implementation):** both artifacts live in the spec's review folder, chosen by `review.location`:
  - `spec-folder` → inside the spec folder, alongside `SPEC.md` / `PLAN.md` / `FLOW.md`: `brain/specs/<domain>/<spec>/RUBRIC.md` + `REPORT.md`;
  - `review-tree` → mirroring the spec path: `<reviews>/<domain>/<spec>/RUBRIC.md` + `REPORT.md`.
- **Case A (standalone):** both artifacts live under a self-contained review folder (create `<reviews>/` if it does not exist yet): `<reviews>/<slug>/RUBRIC.md` + `REPORT.md`.

## Wikilink path convention

Wikilinks are relative to `brain/`. Write `<folder>` for the review folder without its leading `brain/`:

| Case and location | `<folder>` |
|---|---|
| case B, `spec-folder` | `specs/<domain>/<spec>` |
| case B, `review-tree` | `<reviews>/<domain>/<spec>` minus `brain/` (`review/<domain>/<spec>` with the default `brain/review`) |
| case A | `<reviews>/<slug>` minus `brain/` (`review/<slug>` with the default `brain/review`) |

Links to the review artifacts use `<folder>` (`[[<folder>/REPORT]]`, `[[<folder>/RUBRIC]]`); links to the spec always use `specs/<domain>/<spec>`. When `<reviews>` sits outside `brain/`, use relative markdown links instead of wikilinks.

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
  - "[[<folder>/RUBRIC]]"                              # always: the sibling rubric
  - "[[specs/<domain>/<spec>/SPEC]]"                   # case B only
  - "[[specs/<domain>/<spec>/PLAN]]"                   # case B only, if present
  - "[[specs/<domain>/<spec>/FLOW]]"                   # case B only, if present
  - "[[specs/<domain>/<spec>/IMPLEMENTATION-NOTES]]"   # case B only, if present
ingested: false
last_ingested: null
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

- Set `ingested: false` / `last_ingested: null` on creation. **Never set `ingested: true` by hand** — only `docs-maintenance` does, after folding findings into `<techDebt>/` and backlinking the domain pages.
- For **case A** standalone reviews, omit the `specs/...` links entirely. The only required link is the sibling `RUBRIC`.

## Frontmatter — RUBRIC.md (the routing input)

```yaml
---
domain: <domain>
type: review-rubric
scope: spec | standalone
spec: <spec-id or null>
links:
  - "[[<folder>/REPORT]]"   # the sibling report
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

`RUBRIC.md` is the input to verification, not an ingest target, so it does not carry `ingested`/`last_ingested`.

## index.md update

Add a row to the **Reviews** section of `brain/index.md`. If the **Reviews** section does not exist yet, create it.

Case B:

```md
- [[<folder>/REPORT|<domain>/<spec>]] — spec · <verdict> · <review_impact> · <YYYY-MM-DD>
```

Case A:

```md
- [[<folder>/REPORT|<slug>]] — standalone · <verdict> · <review_impact> · <YYYY-MM-DD>
```

## log.md entry

Append to `brain/log.md` (cap at 50 entries; drop oldest when over):

```md
## [YYYY-MM-DD] review | <review target title>
- Report: [[<folder>/REPORT]]
- Scope: spec | standalone
- Verdict: SHIP | DO NOT SHIP
- Impact: low | medium | critical
- Verifiers: <count> (<n> blockers, <n> major)
```

## Tech-debt linkage

This skill does **not** write `<techDebt>/` — that is `docs-maintenance`'s job during ingest (its `references/review-ingest.md`). But make the handoff clean: ensure `REPORT.md` clearly marks which findings are durable (confirmed BLOCKER/MAJOR that won't be fixed before ship) versus fixed-before-merge, so `docs-maintenance` can fold the durable ones into `<techDebt>/<domain>/<spec>.md` (case B) or `<techDebt>/<best-fit-domain>/<slug>.md` (case A) without re-judging.

## Order of operations

1. Write `RUBRIC.md` (end of Stage 1) with its frontmatter.
2. Write `REPORT.md` (Stage 4) with its frontmatter and the consolidated findings.
3. Update `brain/index.md` Reviews section.
4. Append the `brain/log.md` entry.
5. Do not touch domain `flows/`/`concepts/` or `<techDebt>/` — those are downstream of `docs-maintenance`.
