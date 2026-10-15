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
- **Case B only — the acceptance contract.** The relevant `SPEC.md` acceptance criteria the slice must satisfy; an unmet criterion is a finding, at least MAJOR. Add the `FLOW.md` rows that cite those criteria only to locate them in the flow (which state, which entry point). A `FLOW.md` row with no criterion behind it is not part of the contract and never a finding by itself.
- **Motion-craft pass only — the review bar.** When the rubric chartered a pass on animation/motion code (its charter begins `Motion-craft pass:`), give that verifier the `design-engineer` agent's review bar as its rubric: `.agents/skills/design-engineering/references/review.md` (with `standards.md` for exact values; findings table + six-tier verdict + Block/Approve), falling back to the baseline motion standards in `.agents/agents/design-engineer.md` only when the skill is missing. Project tokens and documented motion decisions in `brain/chore/` win over both. The pass keeps motion and drops target size: static UI, target size included, is the UI pass's.
- **UI pass only — the `ui-review` bar, on the served route.** When the rubric chartered a UI pass (its charter begins `UI pass:`), give that verifier the `ui-review` skill as its rubric and its probes: `<skillsDir>/ui-review/SKILL.md` and its class pages under `references/` (`<skillsDir>` is the `skillsDir` in `brain/.brain-manifest.json`, `.agents/skills` by default), plus `brain/chore/ui-review.md` when it exists, whose Project bar wins over the skill's defaults.
  - **What it checks.** Case A: the skill's bar on the changed surface (the components and states the change touches, over the full width range). Case B: the spec's UI acceptance criteria **and** the bar on the changed surface, because the implementation adds defects the prototype did not have.
  - **The route.** The URLs the orchestrator served for each changed surface (`SKILL.md` → UI pass: serve the route), and a session name of the pass's own (`review-ui-<slug>`), never the default one.
  - **Guide load.** Before the first `agent-browser` command, run `agent-browser skills get core` and follow it: it is the usage guide for the installed version.
  - **Scripts.** Always `bash <skillsDir>/ui-review/scripts/<script>.sh …`: installed files carry no exec bit, so a bare script path fails.
  - **Read-only contract.** Driving `agent-browser` against the served route is within the verifier's read-only contract, DOM injection and `network route` mocks included. No file, server or data changes; screenshots and probe output go to a `mktemp -d` folder outside the project tree.
  - **Findings.** Each in the verifier's block, with the skill's evidence: location (selector, state, width range), engine, the probe's measured value or the opened screenshot against the required value, the rule, one fix. No UX findings and no motion findings.
  - **Without a route** (no dev command in the root `AGENTS.md`, the command fails, or no route renders the surface): brief the verifier with the code only. The pass opens with `DEGRADED`, states no measured value, and `REPORT.md` → Coverage says why.
  - **Without the skill** (`<skillsDir>/ui-review/SKILL.md` is not installed): spawn no UI pass, and write one line under `REPORT.md` → Coverage. It is not a failed pass, so it never holds the verdict.
- **The project non-negotiables the concern implicates.** Read them from the project's own sources at runtime — do not assume a stack:
  - the root `AGENTS.md` (fallback: `CLAUDE.md` when no `AGENTS.md` exists) — the project's gates (build/test/lint commands, contract/codegen chains) and any explicit coding/security rules;
  - `brain/` — the touched domain's contract (`domains/<domain>/<domain>-contract.md`: Owns / Does Not Own / Invariants), relevant concept/flow pages, and known drift in `<techDebt>/`;
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
