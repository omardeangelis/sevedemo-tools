# Classification Phase (Stage 1)

Use this reference after scope is resolved. This stage runs the `review-classifier` agent **once** and produces `RUBRIC.md`. It always runs before any verifier.

## Why classify first

The classifier decides *how the verification stage should run*: how many independent adversarial passes, at what model complexity, and whether a human must be in the loop. Running it first means the fan-out in Stage 2 is sized to the change's real risk and breadth instead of a guess. The classifier never reviews the code itself.

## Run the classifier agent

Delegate via the `Agent` tool with `subagent_type: "review-classifier"`. Brief it self-contained — it has a clean context and only sees what you pass.

Pass:
- the change set as the raw output to classify: the unified diff and the changed-file list (mapped to the project's modules/areas where possible), plus the base/head refs;
- the case (A standalone / B spec) and resolved domain(s);
- the project's risk surface and gates as you read them from the root `AGENTS.md` and `brain/` (see validation point 3) so the classifier can weigh sensitivity without assuming a stack;
- for **case B**: a tight excerpt of `SPEC.md` acceptance criteria and `FLOW.md` (if present) so the classifier can weigh the change against intended behavior;
- nothing about who wrote the change. Authorship is irrelevant and biases routing.

Ask it to return its routing RUBRIC as the JSON object it specifies, with this shape:

```json
{
  "taskType": "<feature|refactor|bugfix|config|dependency|security|docs|test|ui|data-access|integration>",
  "secondaryType": "<type or null>",
  "domainsTouched": ["<domain>", "..."],
  "adversarialVerifiers": {
    "count": <int>,
    "passes": [
      { "id": "v1", "charter": "<single isolated concern>", "complexity": "low|medium|high" }
    ]
  },
  "taskComplexity": "low|medium|high",
  "reviewImpact": "low|medium|critical",
  "humanInLoop": <true|false>,
  "nextStep": "<routing instruction>"
}
```

## Validate the RUBRIC before using it

Do not blindly trust the JSON. Check:

1. `passes[]` is non-empty and each pass has a **single, isolated, non-overlapping** charter. If two passes overlap, that is the classifier's bug — re-prompt it, don't merge by hand.
2. `reviewImpact` is consistent with `humanInLoop`: `critical ⇒ true`; `low ⇒ false`.
3. **Security-sensitive surfaces forced an escalation.** Determine the project's risk surface from its own sources rather than a fixed list:
   - the root `AGENTS.md` (its security rules, protected paths, release/build gates, contract/codegen chains),
   - `brain/` domain contracts and `tech-debt/` (which areas are fragile, which invariants must hold),
   - and generic always-sensitive categories: authentication / authorization / token handling, secrets and credentials, payments / billing / money movement, untrusted-input handling and sanitization (e.g. raw HTML, SQL, shell, deserialization), PII / analytics / telemetry, data migrations, and build / release / CI configuration.

   If the change touches any surface the project flags as sensitive, or any of the generic categories above, expect `reviewImpact: critical`. If the classifier did not escalate one of these, re-prompt or override upward and note the override in `RUBRIC.md`.
4. `count` is justified by breadth/isolation, not arbitrary. Trivial isolated change → 1; moderate multi-concern → 2–3; broad/critical → 3–5+.

## Write RUBRIC.md

Save the result to `<output-folder>/RUBRIC.md` using [../assets/RUBRIC-TEMPLATE.md](../assets/RUBRIC-TEMPLATE.md):
- frontmatter per [brain-bookkeeping.md](brain-bookkeeping.md),
- the verbatim classifier JSON inside a ```json block,
- the classifier's plain-language rationale,
- any override you applied and why.

`RUBRIC.md` is the input contract for Stage 2 — every `passes[]` entry becomes exactly one `adversarial-verifier` run.
