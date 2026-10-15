---
name: create-spec
description: Create a SPEC.md file for a new feature, product, or system using the Spec-Driven Development (SDD) approach. The spec works in the problem space — it clarifies the "what", not the "how", and when backlog context exists it maps to one epic/capability and must unify all child-story requirements beneath it. Use this skill whenever the user wants to write a spec, define requirements, capture what needs to be built, create a specification document, or start the SDD workflow.
---

# Spec Creator

## Contract

- **Role:** higher-order spec authoring skill
- **Entrypoint type:** public entrypoint
- **Upstream:** new idea, feature request, epic/capability issue, or problem statement
- **Delegates to:** none
- **Downstream:** reviewed `SPEC.md`, then usually `create-plan` or `implement-spec`
- **Entry conditions:** brain domain can be resolved, or the user scaffolds one first under `brain/domains/<domain>/`
- **Stop conditions:** `SPEC.md`, brain index, and brain log are updated, then wait for user review

This skill creates `SPEC.md` files that stay in the problem space: what to build, who it is for, why it matters, what counts as done, and what is out of scope.

When backlog context exists, one `SPEC.md` maps to one parent epic/capability issue and must cover the full scope of that epic. If the epic has child stories, the spec must explicitly incorporate and unify the requirements of all of them.

The output lives at `brain/specs/<domain>/<folder-name>/SPEC.md`.

## Quick start

1. Read `brain/AGENTS.md` first. Stop if the brain is not bootstrapped. Read `brain/brain.config.json` (keys in `brain/AGENTS.md` → Project configuration). If it is absent, use the defaults listed there.
2. Read `references/discovery.md` and orient yourself in the right brain domain before asking questions.
3. If backlog context exists, read the parent epic and every child story before asking questions.
4. If the user did not provide a concrete request, ask for a rough description first.
5. Read `references/questioning.md` and ask only the clarifying questions needed to write a trustworthy spec.
6. Read `references/folder-naming.md` to resolve the domain and spec folder path.
7. Read `assets/SPEC-TEMPLATE.md` and write the spec. Name the target persona(s) in Context from `<personas>`, using its segment names verbatim. When `paths.personas` is `null`, name the roles affected and add an open question asking who the users are.
8. **If the spec starts from an approved `prototype` winner** (handed over by `prototype` Phase 6 in this run, or cited by the user by path and route):
   - cite it in `SPEC.md` by path and route;
   - inherit its exact values (easing, durations, layout, states, copy) as decisions;
   - list what the prototype faked (endpoints, permissions, real data) under open questions.

   When a **`ux-advisor` review** or a **`ui-reviewer` review** came with it (in context, or saved next to the surviving variant as `UX-REVIEW.md` and `UI-REVIEW.md`), read `references/flow-map.md` and follow it:
   - turn each decision of either review into an acceptance criterion; bundle the UX task-accessibility fixes into one criterion, and the UI mechanical fixes into another;
   - merge a UX finding and a UI finding on the same element into one criterion: the UI wording carries the cause and the fix, the UX wording the task consequence;
   - carry the UI review's "Not verified on device" checks into Constraints;
   - carry their open questions into Open Questions, each with its recommended default;
   - record the prototype changes already applied in the Decision Log, with their exact values;
   - write `FLOW.md`, the flow map that cites the criteria, from the template there. Only a UX review produces one; UI criteria need no row in it.

   When the user rejects a finding, offer to append it, with the reason, to its reviewer's page → Suppressed findings: `brain/chore/ux-review.md` for a UX finding, `brain/chore/ui-review.md` for a UI finding. Create the page on first use; leave the Project bar of `ui-review.md` for the user. Never spawn `ux-advisor` or `ui-reviewer` yourself: they run only from `prototype`.
9. **If the spec is user-facing and no prototype review exists** (any acceptance criterion maps to a screen, form, navigation, or interaction a user perceives), write no `FLOW.md`. Say in one line that no UX or UI review ran, and suggest the user run **`prototype`** when a visual or interaction direction is open or the flow's states have never been seen rendered. `prototype` is explicit invocation only: never trigger it yourself; resume when the user brings a winner.
10. Read `references/spec-quality-bar.md`. **Gate — `review.mode` ∈ {total}:** verify the spec against that bar **without spending orchestrator context**: delegate to the **`adversarial-verifier`** agent in quality-gate mode, briefed self-contained with the draft `SPEC.md` (and `FLOW.md` as a map, if written) and the quality bar as its rubric. Treat any BLOCKER it returns as a must-fix before saving. Skip only if the agent is absent; if your tool cannot spawn subagents, run its charter inline instead (see `brain/AGENTS.md` → Advisor subagents). — otherwise self-check the spec against the quality bar, offer the verifier pass in one line, and continue.
11. Read `references/brain-bookkeeping.md` to update `index.md`, `<domain>-specs.md`, and `log.md`.
12. Read `references/handoff.md` to choose the next-step recommendation and stop after user review.

## Workflow

### Default workflow

1. Build orientation first; do not jump straight into writing.
2. Ask only enough to make the spec crisp, testable, and bounded.
3. When an epic has child stories, harvest and preserve each story's requirements before drafting.
4. Keep the spec free of implementation detail.
5. Use the template structure exactly, then remove all template scaffolding.
6. When the spec starts from an approved prototype, fold its `ux-advisor` and `ui-reviewer` reviews into the acceptance criteria, one criterion per defect, and write the `FLOW.md` map from the UX review (Quick start step 8). A user-facing spec without one gets no `FLOW.md` and a one-line `prototype` suggestion (step 9). Then gate the spec against the quality bar per `review.mode` (step 10): the `adversarial-verifier` agent under `total`, a self-check otherwise.
7. Update brain bookkeeping in the same run.
8. Stop after presenting the spec and the recommended next step.

## Advanced features

- Discovery and repo orientation: see [references/discovery.md](references/discovery.md)
- Clarifying-question strategy: see [references/questioning.md](references/questioning.md)
- Domain and folder naming rules: see [references/folder-naming.md](references/folder-naming.md)
- Acceptance-criteria and quality bar: see [references/spec-quality-bar.md](references/spec-quality-bar.md)
- Prototype reviews (UX and UI) → acceptance criteria, and the `FLOW.md` map: see [references/flow-map.md](references/flow-map.md)
- brain index and log updates: see [references/brain-bookkeeping.md](references/brain-bookkeeping.md)
- Review closeout and next-step routing: see [references/handoff.md](references/handoff.md)

## Project Advisors

The shipped **`adversarial-verifier`** (spec quality gate, per `review.mode`) is already wired into the Quick start steps above. **`ux-advisor`** and **`ui-reviewer`** are not spawned here: they run only from `prototype`, and this skill consumes their reviews (step 8). List any *additional* project-specific advisors here (e.g. a domain or security expert) and init-brain will pick them up. When a trigger matches, delegate via the `Agent` tool with `subagent_type: "<agent-name>"`, briefed self-contained.

<!-- init-brain:advisors:start -->
_No project advisor agents detected beyond the shipped defaults. If this project defines more agents under `.claude/agents/` or `.agents/agents/`, list each here as: **`<name>`** — trigger — when to delegate._
<!-- init-brain:advisors:end -->
