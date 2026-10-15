# Review Ingest

Use this reference for the `## Secondary: Review Ingest` path: ingesting an adversarial review report (`REPORT.md`) produced by the `adversarial-review` skill.

A review is a point-in-time quality judgment, **not** durable domain knowledge. So review ingest never writes flow or concept pages. It folds the report's lasting findings into the tech-debt store, backlinks the review, marks it ingested, and logs it.

Read `brain/brain.config.json` first (keys in `brain/AGENTS.md` → Project configuration; absent → the defaults there): `paths.techDebt` (`<techDebt>`), `paths.reviews` (`<reviews>`) and `review.location` decide every path below.

## Resolve the target

Accept:
- a case B review: the spec's review folder — `brain/specs/<domain>/<spec>/` under `review.location: spec-folder`, or `<reviews>/<domain>/<spec>/` under `review-tree`;
- a case A review folder: `<reviews>/<slug>/`;
- an explicit `REPORT.md` path.

Normalize to the `REPORT.md` file. Read its frontmatter to learn `scope` (spec / standalone), `domain`, `spec`, and `verdict`.

**Wikilinks** to the report use `<folder>`, the review folder relative to `brain/`: `specs/<domain>/<spec>` (spec-folder), `<reviews>/<domain>/<spec>` minus `brain/` (review-tree), `<reviews>/<slug>` minus `brain/` (case A). This is the same convention as `adversarial-review`'s `references/brain-bookkeeping.md`.

## Step R1 — Guard

If the report frontmatter has `ingested: true`, exit with a clear no-op message: its findings are already in the tech-debt store.

## Step R2 — Read the report

Read `REPORT.md` fully. Collect:
- the **Findings** table, especially rows marked `Durable? = yes` (confirmed BLOCKER/MAJOR the team chose not to fix before ship);
- the overall `verdict` and `review_impact`;
- the **Notes for docs-maintenance** section, which already names the durable findings and the pages to backlink.

Trust the report's own durability marking; do not re-judge findings. If `Durable?` is blank everywhere and the verdict is `SHIP` with no MAJOR/BLOCKER, there may be nothing durable to fold: record that and skip to Step R5.

## Step R3 — Fold durable findings into the tech-debt store

Target file:
- **case B** → `<techDebt>/<domain>/<spec>.md`
- **case A** → `<techDebt>/<domain>/<slug>.md`, using the report's `domain` (or `_unscoped` when none resolved)

Create the file if absent; **append**, never overwrite. Use this shape:

```md
## [YYYY-MM-DD] From review [[<folder>/REPORT]]

- **[<SEVERITY>]** <finding> — `file:line`
  - Why it persists: <one line>
  - Fix-or-evidence needed: <from the report>
```

Each durable finding becomes one bullet. Keep the wording from the report: this is bookkeeping, not re-analysis.

## Step R4 — Backlink (case B only)

For the flow and concept pages the durable findings bear on, add `[[<folder>/REPORT]]` to their `links` array if not already present. Also add it to the spec's `IMPLEMENTATION-NOTES.md` `links`.

Case A has no domain pages to backlink: the tech-debt entry is the anchor, and the report already links its sibling `RUBRIC`.

## Step R5 — Mark ingested

Update the report frontmatter:

```yaml
ingested: true
last_ingested: YYYY-MM-DD
```

This is the only place a review report is marked ingested. Never set it by hand elsewhere.

## Step R6 — Log

Append to `brain/log.md` (cap at 50 entries; drop the oldest when over):

```md
## [YYYY-MM-DD] review-ingest | <review target title>
- Report: [[<folder>/REPORT]]
- Verdict: SHIP | DO NOT SHIP
- Durable findings folded to tech debt: <count>
```

When review ingest ran as part of a spec ingest (case B), extend that run's log entry with its `Review ingested:` line instead of adding a second entry.

## Never do

- Synthesize review findings into `flows/` or `concepts/` pages.
- Overwrite an existing tech-debt page — always append a dated section.
- Re-judge findings or change their severity — carry the report's own classification.
- Ingest a report twice — the `ingested: true` guard is authoritative.
