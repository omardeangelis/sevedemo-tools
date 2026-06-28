# Stop Conditions

Use this reference to close the review run.

## Stop here

Yield after the review is persisted. Stop after:

- `RUBRIC.md` and `REPORT.md` are written — case B: inside the spec folder `brain/specs/<domain>/<spec>/`; case A: under `brain/review/<slug>/`
- `brain/index.md` (Reviews) and `brain/log.md` are updated
- the overall verdict is stated in the conversation
- the **Human Review Checklist** is surfaced prominently when `reviewImpact: critical`

## User-facing closeout

Tell the user:

- where the review was saved (the spec folder for case B, or the `brain/review/<slug>/` folder for case A)
- the overall verdict (`SHIP` / `DO NOT SHIP`) and the impact level
- the count of BLOCKER / MAJOR findings, and the single strongest objection if `DO NOT SHIP`
- for `critical` reviews: that a human checklist is required before proceeding, and where it is
- the suggested next step:
  - `DO NOT SHIP` → remediate the BLOCKER/MAJOR findings (this skill does not fix them), then re-run the review
  - `SHIP` (case B) → run `docs-maintenance` to ingest the spec and this review (fold durable findings into `tech-debt/`)
  - `SHIP` (case A) → optionally run `docs-maintenance` on the review folder to record durable findings

Then stop and wait.

## Do not

- Fix, edit, or implement the reviewed code from this skill.
- Set `ingested: true` on the report — that is `docs-maintenance`'s job.
- Write domain `flows/`/`concepts/` or `tech-debt/` pages — those are downstream of ingest.
- Continue into remediation or re-review without the user's go-ahead.
