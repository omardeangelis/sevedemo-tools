---
domain:                       # case B: spec domain. case A: best-fit domain or _unscoped
type: review-rubric
scope:                        # spec | standalone
spec:                         # case B: spec id/folder name. case A: null
links:
  - "[[specs/<domain>/<spec>/REPORT]]"   # case B sibling report; case A: "[[review/<slug>/REPORT]]"
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Review Rubric: [Review Target]

<!--
INSTRUCTIONS (remove this block before saving):
- This file is the output of the `review-classifier` agent (Stage 1). It drives the verification fan-out.
- Paste the classifier's JSON verbatim. Each `passes[]` entry becomes exactly one adversarial-verifier run in Stage 2.
- Record any override you applied to the classifier's output and why.
-->

## Change set under review

- **Scope:** <spec implementation | standalone>
- **Target:** <PR #N | branch <name> | path glob>
- **Compared:** `<base_ref>` → `<head_ref>`
- **Files touched:** <count> across domains: <domain list>

## Routing rubric (review-classifier output)

```json
{
  "taskType": "",
  "secondaryType": null,
  "domainsTouched": [],
  "adversarialVerifiers": {
    "count": 0,
    "passes": [
      { "id": "v1", "charter": "", "complexity": "low" }
    ]
  },
  "taskComplexity": "low",
  "reviewImpact": "low",
  "humanInLoop": false,
  "nextStep": ""
}
```

## Classifier rationale

_2-5 sentences from the classifier explaining the key routing decisions, especially anything that drove an escalation._

## Overrides applied

_None — or: the override made to the classifier output (e.g., escalated reviewImpact to critical because the diff touches a security-sensitive surface the project's AGENTS.md flags) and the reason._

## Verification plan (derived)

| Pass | Charter | Complexity | Model tier |
|------|---------|------------|------------|
| v1 | | low | fast |

_One row per `passes[]` entry. Model mapping by tier (use your runtime's concrete id for each): low → fast/cheap, medium → balanced mid-tier, high/critical → strongest available (e.g. an Opus-class model)._
