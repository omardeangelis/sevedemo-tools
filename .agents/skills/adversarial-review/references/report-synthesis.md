# Report Synthesis (Stage 4)

Use this reference after all verifier verdicts are collected. This stage consolidates them into one `REPORT.md` with a single overall verdict.

## Build the report

Write `<output-folder>/REPORT.md` from [../assets/REPORT-TEMPLATE.md](../assets/REPORT-TEMPLATE.md).

1. **Findings table.** Merge all verifier `FINDINGS` into one table. For each: severity, the concern/charter it came from (verifier `id`), `file:line`, the concrete problem, and the required fix-or-evidence. Deduplicate findings that two verifiers raised about the same location, but keep both perspectives in the note.
2. **What passed.** Aggregate the `WHAT PASSED` evidence per concern so the report shows what was genuinely checked, not just what failed. A report with only failures hides coverage gaps.
3. **Per-concern verdicts.** One row per rubric pass: charter → verifier verdict (`SHIP`/`DO NOT SHIP`) → one-line rationale. Note any pass that could not run.
4. **Coverage note.** State which rubric passes ran, at what model, and any pass that was skipped or failed. Never imply full coverage when a pass is missing.

## Severity scale

Carry the verifier scale through unchanged:

- **BLOCKER** — must fix before ship. Correctness bug, security hole, contract violation, unhandled critical path, a failed project gate, or a CONTRADICTED claim that materially affects the change.
- **MAJOR** — should fix before ship; significant risk or standards violation, but not strictly blocking on its own.
- **MINOR** — fix soon; limited blast radius.
- **NIT** — optional polish.

## Overall verdict rules

- Overall verdict is `DO NOT SHIP` if **any** verifier holds an unresolved BLOCKER, **any** claim is CONTRADICTED in a way that matters, or **any** required pass could not run on a `critical` review.
- Otherwise the verdict is `SHIP`, but only after a genuine attempt to break the change found no blocking failure. If `SHIP` came too easily on a non-trivial change, re-examine — a verifier may have absorbed a hint or been under-scoped.
- When evidence is insufficient to judge, default to `DO NOT SHIP` and state exactly what evidence is needed.

## Human-in-the-loop checklist

If `RUBRIC.md` set `reviewImpact: critical` / `humanInLoop: true`, the report MUST include a **Human Review Checklist**: an ordered, concrete list of steps a human is required to follow before anything proceeds (what to re-verify, where, and what "good" looks like — including running the project's declared gates from the root `AGENTS.md`). This is the deliverable for critical changes — not optional prose.

For `reviewImpact: medium`, include a shorter "Suggested manual validation" list the human may optionally follow. For `low`, no checklist is required.

## Honesty rules

- Attribute every BLOCKER/MAJOR to its verifier and locate it by `file:line`. No floating claims.
- Do not soften a verdict to be agreeable. The report's value is its detachment.
- Do not propose to fix the findings here. The report ends at the verdict and the checklist; remediation is a separate action (and confirmed durable findings flow into `tech-debt/` via `docs-maintenance`).
