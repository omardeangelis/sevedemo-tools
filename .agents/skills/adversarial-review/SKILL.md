---
name: adversarial-review
description: Run a two-stage adversarial review of a code change — first classify the change with the review-classifier agent to produce a routing RUBRIC, then fan out one independent adversarial-verifier agent per concern, and consolidate the verdicts into a SHIP / DO-NOT-SHIP REPORT. Handles two cases — (A) a standalone review of a diff, branch, or PR outside any spec, and (B) a review of a spec implementation tied to a brain/specs/<domain>/<spec>/ folder. Saves both artifacts (RUBRIC.md, REPORT.md) so docs-maintenance can ingest the findings. Reads the project's real gates from the root AGENTS.md and conventions/risk surface from brain/, never assuming a stack. Use when a diff, branch, PR, or spec implementation needs an independent, bias-free quality gate before it ships.
---

# Adversarial Review

## Contract

- **Role:** higher-order review orchestrator
- **Entrypoint type:** public entrypoint
- **Upstream:** a code change ready for review — a branch/PR diff (case A), or a spec implementation produced by `implement-spec` (case B)
- **Required agents:** `review-classifier` (Stage 1, routing), then `adversarial-verifier` (Stage 2, fan-out) — order non-negotiable
- **Downstream:** `docs-maintenance` ingests the saved `REPORT.md` (folds confirmed durable findings into `tech-debt/`, backlinks, marks ingested)
- **Entry conditions:** a resolvable change set (diff/files) exists; the root `AGENTS.md` is readable so the project's gates are known; for case B the spec folder under `brain/specs/<domain>/<spec>/` exists
- **Stop conditions:** `RUBRIC.md` + `REPORT.md` are written (case B: into the spec folder; case A: under `brain/review/<slug>/`), brain bookkeeping is synced, and the verdict plus any human-in-the-loop checklist are surfaced — then wait

This skill is a quality gate. It never fixes code and never implements. It produces an independent, source-grounded verdict (`SHIP` / `DO NOT SHIP`) backed by per-concern adversarial verification, and persists it as a reviewable brain artifact.

## Required Agents

The pipeline order is non-negotiable: **classify first, then verify.**

- MUST use the `review-classifier` agent (Stage 1) to produce the routing RUBRIC. Never decide verifier count / complexity / impact by hand.
- MUST use the `adversarial-verifier` agent (Stage 2) — one independent pass per `passes[]` entry the rubric emits. Each verifier gets a clean context and a single isolated charter.

Delegate to both via the `Agent` tool with `subagent_type: "review-classifier"` and `subagent_type: "adversarial-verifier"`. If a required agent is unavailable, stop clearly and report the missing dependency.

## Pipeline

```
adversarial-review (orchestrator)
  └─ 1. Scope & artifact resolution  — case A vs B, gather the diff/files, resolve the output folder
  └─ 2. Classification phase         — review-classifier → RUBRIC.md (passes, complexity, impact, humanInLoop)
  └─ 3. Verification phase           — fan out one adversarial-verifier per rubric pass (parallel) → raw findings
  └─ 4. Report synthesis             — consolidate verdicts → REPORT.md (severities, verdict, human checklist)
  └─ 5. Brain bookkeeping            — frontmatter, index.md, log.md, tech-debt linkage
  └─ 6. Stop                         — present verdict + next step, wait for the user
```

## Quick start

1. Read the root `AGENTS.md` first to learn this project's real gates (build/test/lint commands, review gates, contract/codegen chains), then `brain/AGENTS.md` for the knowledge-base schema. Stop if the brain is not bootstrapped.
2. Read `references/scope-and-naming.md`. Decide **case A** (standalone) vs **case B** (spec), gather the change set from git/PR state, and resolve the output folder:
   - case A → `brain/review/<slug>/` (create `brain/review/` if it does not exist yet)
   - case B → the spec folder `brain/specs/<domain>/<spec>/` (artifacts sit alongside `SPEC.md`/`PLAN.md`/`FLOW.md`)
3. For case B, load the spec working set: `SPEC.md`, `FLOW.md` (if present), `PLAN.md` (if present), `IMPLEMENTATION-NOTES.md` (if present). These become the acceptance contract the verifiers judge against.
4. Read `references/classification-phase.md` and run the `review-classifier` agent on the change set. Save its output as `RUBRIC.md` from `assets/RUBRIC-TEMPLATE.md`.
5. Read `references/verification-phase.md` and spawn one `adversarial-verifier` agent per `passes[]` entry — in parallel, each with its scoped charter, the relevant artifact slice, the project non-negotiables read from the root `AGENTS.md` and `brain/`, and (case B) the acceptance criteria + `FLOW.md` paths it must check. Map each pass's `complexity` to a model.
6. Read `references/report-synthesis.md` and consolidate the verifier verdicts into `REPORT.md` from `assets/REPORT-TEMPLATE.md`. The overall verdict is `DO NOT SHIP` if any verifier returns an unresolved BLOCKER or a CONTRADICTED claim.
7. If the rubric set `reviewImpact: critical` / `humanInLoop: true`, the report MUST carry a step-by-step checklist a human is required to follow before anything proceeds.
8. Read `references/brain-bookkeeping.md` to write frontmatter, update `brain/index.md` (Reviews), append to `brain/log.md`, and (case B) backlink the spec.
9. Read `references/stop-conditions.md` and stop exactly there.

## Workflow

### Default workflow

1. Resolve scope before doing anything else — never run verifiers against an undefined change set.
2. Learn the project's gates and conventions from the root `AGENTS.md` and `brain/` rather than assuming a stack; pass the in-scope ones to the verifiers.
3. Classify with the `review-classifier` agent first; let its RUBRIC drive how many verifiers run, at what model, and whether a human is required.
4. Fan out independent verifiers — one isolated concern each, no overlap, clean context per agent. Authorship of the change is never passed to a verifier.
5. Synthesize honestly: every BLOCKER/MAJOR finding is attributed to its verifier and located by file/line; every PASS states its evidence.
6. Persist both artifacts (case B: in the spec folder; case A: under `brain/review/<slug>/`) with ingest-tracking frontmatter so `docs-maintenance` can pick up the findings.
7. Surface the verdict and (when critical) the human checklist, then stop. Do not fix the findings in this skill.

### Case selection

- **Case A — standalone / generic code review.** No spec in scope. The change set is a branch diff, a PR, a path glob, or the working tree. Output lands in a self-contained `brain/review/<slug>/` with no spec backlinks. Use this for ad-hoc reviews, refactors, hotfixes, or any code not tracked by a spec.
- **Case B — spec implementation review.** A spec folder exists at `brain/specs/<domain>/<spec>/` and was implemented (usually by `implement-spec`). Output lands **inside that same spec folder** — `RUBRIC.md` and `REPORT.md` sit alongside `SPEC.md`/`PLAN.md`/`FLOW.md` — and the review backlinks the spec's `SPEC.md` / `PLAN.md` / `IMPLEMENTATION-NOTES.md`. Verifiers judge the implementation against the spec's acceptance criteria and `FLOW.md`.

If the user did not say which case applies, infer it: a named/resolvable spec folder → case B; otherwise case A. State the chosen case in the conversation.

### Model selection (per verifier)

The rubric assigns a `complexity` per pass. Map it to a model tier when spawning each `adversarial-verifier` — use the concrete model id your runtime exposes for each tier, do not hardcode a vendor:

- `low` → the fast / cheap model tier
- `medium` → the balanced mid-tier model
- `high` / `critical` → the strongest reasoning model available (e.g. an Opus-class model), or omit `model` to inherit

## Advanced features

See [REFERENCE.md](REFERENCE.md) for the overview and phase map.

- Scope resolution, case A vs B, artifact gathering, output naming: see [references/scope-and-naming.md](references/scope-and-naming.md)
- Classification phase (classifier agent + RUBRIC): see [references/classification-phase.md](references/classification-phase.md)
- Verification phase (verifier fan-out + briefs): see [references/verification-phase.md](references/verification-phase.md)
- Report synthesis, severities, verdict rules, human checklist: see [references/report-synthesis.md](references/report-synthesis.md)
- Brain bookkeeping, frontmatter, index/log, tech-debt linkage: see [references/brain-bookkeeping.md](references/brain-bookkeeping.md)
- Stop conditions: see [references/stop-conditions.md](references/stop-conditions.md)

## Never do

- Run verifiers before the classifier — the RUBRIC drives the fan-out.
- Decide verifier count, complexity, or human-in-the-loop policy by hand instead of from the classifier's RUBRIC.
- Hardcode a stack, gate command, or model vendor — read the project's gates from the root `AGENTS.md` and its conventions/risk surface from `brain/`, and map complexity to a model tier rather than a fixed id.
- Pass change authorship, praise, effort spent, prior approvals, or "please approve" cues to a verifier — verifiers must judge from a clean context.
- Fix, edit, or implement the reviewed code from this skill — it is a gate, not an executor. Findings flow to the user and to `tech-debt/` via `docs-maintenance`.
- Mark a review `ingested: true` by hand — only `docs-maintenance` sets that.
- Report `SHIP` while any verifier holds an unresolved BLOCKER or a CONTRADICTED claim.
