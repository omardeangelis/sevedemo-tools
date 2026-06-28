# Verification Phase (Stage 2)

Use this reference after `RUBRIC.md` exists. This stage runs one `adversarial-verifier` agent per `passes[]` entry, in parallel, and collects their raw verdicts for synthesis.

## One pass = one verifier = one isolated concern

For each entry in `adversarialVerifiers.passes[]`, spawn exactly one `adversarial-verifier` via the `Agent` tool with `subagent_type: "adversarial-verifier"`. Launch them **in parallel** — issue all the Agent calls in a single message so they run concurrently. They are independent by design; never let one verifier's charter leak into another's.

Map each pass's `complexity` to a model tier via the `model` option, using the concrete model id your runtime exposes for that tier — do not hardcode a vendor:

- `low` → the fast / cheap model tier
- `medium` → the balanced mid-tier model
- `high` / `critical` → the strongest reasoning model available (e.g. an Opus-class model), or omit `model` to inherit

## Verifier brief (per pass)

Each verifier has a clean context. Brief it self-contained with **only**:

- **The rubric (its charter).** The single concern from `passes[].charter`, stated as the criteria to judge against. This is the verifier's RUBRIC USED.
- **The artifact slice.** The portion of the diff/files relevant to that charter (and the files it must read to judge them). Give it enough surrounding context to judge correctly, but keep it scoped to its concern.
- **Case B only — the acceptance contract.** The relevant `SPEC.md` acceptance criteria and the matching `FLOW.md` happy path / error paths / edge cases the slice must satisfy. An unhandled error path or empty/permission/async edge case is a finding, not a nice-to-have.
- **The project non-negotiables the concern implicates.** Read them from the project's own sources at runtime — do not assume a stack:
  - the root `AGENTS.md` — the project's gates (build/test/lint commands, review gates, contract/codegen chains) and any explicit coding/security rules;
  - `brain/` — the touched domain's contract (`domains/<domain>/<domain>-contract.md`: Owns / Does Not Own / Invariants), relevant concept/flow pages, and known `tech-debt/`;
  - generic engineering invariants that always apply: correctness, no secrets in code, untrusted input is validated/sanitized, errors and edge cases are handled, public contracts are honored, and the change passes the project's declared gates.

  Name only the non-negotiables that are actually in scope for this pass — enough for the verifier to judge against the project's real standards, not a generic checklist.

Do **not** pass: who wrote the change, how much effort it took, prior approvals, or any nudge to pass. If such a cue is unavoidable in the source material, instruct the verifier to disregard it (it will note this as HINTS DISREGARDED).

## Expected verifier output

Each verifier returns its standard block:

```
MODE: <claim-checking | code-review | quality-gate>
RUBRIC USED: <criteria; note if self-generated>
HINTS DISREGARDED: <cues ignored, or "none">
FINDINGS:
- [BLOCKER|MAJOR|MINOR|NIT] <criterion>: <problem + file/location + concrete fix-or-evidence>
WHAT PASSED:
- <criterion>: <evidence>
VERDICT: SHIP | DO NOT SHIP
RATIONALE: <one paragraph>
IF DO NOT SHIP: <single strongest blocking objection>
```

## Collect, don't merge yet

Gather every verifier's block verbatim, tagged by its pass `id` and charter. Do not resolve conflicts or dedupe here — that happens in [report-synthesis.md](report-synthesis.md). If a verifier returns `null` / dies on a terminal error, note the missing pass; a missing pass on a `critical` review is itself a `DO NOT SHIP` until re-run.

## Orchestration rules

- The verifier owns one concern and its judgment. This skill owns fan-out, model selection, and synthesis.
- Never collapse two rubric passes into one verifier to save calls — isolation is the point.
- If a verifier asks for evidence it was not given (e.g., a file outside its slice it needs to judge), supply it and let it re-judge rather than guessing on its behalf.
- Re-run a pass (not the whole review) when its output is malformed or the agent failed.

## Clean-context do-nots

- Never pass authorship, prior approvals, effort spent, or any "this should pass" framing into a verifier brief.
- Never let one verifier see another verifier's charter, slice, or verdict.
- Never inject your own opinion of the change's quality — the verifier's detachment is the whole signal.
