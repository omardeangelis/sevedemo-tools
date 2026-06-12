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

1. Read `brain/AGENTS.md` first. Stop if the brain is not bootstrapped.
2. Read `references/discovery.md` and orient yourself in the right brain domain before asking questions.
3. If backlog context exists, read the parent epic and every child story before asking questions.
4. If the user did not provide a concrete request, ask for a rough description first.
5. Read `references/questioning.md` and ask only the clarifying questions needed to write a trustworthy spec.
6. Read `references/folder-naming.md` to resolve the domain and spec folder path.
7. Read `assets/SPEC-TEMPLATE.md` and write the spec.
8. **If the spec describes a user-facing UI flow** (any acceptance criterion that maps to a screen, form, navigation, or interaction the user perceives) **and this project defines a UX/design advisor agent** (see `## Project Advisors`), delegate to it via the `Agent` tool before the quality bar gate. Brief it with the draft `SPEC.md`, the target persona, and the surface in scope. Incorporate its findings into the spec. Skip if the spec is purely backend/contract with no UI touchpoint, or if no such advisor exists — and state that judgment in the conversation.
9. Read `references/spec-quality-bar.md` before saving.
10. Read `references/brain-bookkeeping.md` to update `index.md`, `<domain>-specs.md`, and `log.md`.
11. Read `references/handoff.md` to choose the next-step recommendation and stop after user review.

## Workflow

### Default workflow

1. Build orientation first; do not jump straight into writing.
2. Ask only enough to make the spec crisp, testable, and bounded.
3. When an epic has child stories, harvest and preserve each story's requirements before drafting.
4. Keep the spec free of implementation detail.
5. Use the template structure exactly, then remove all template scaffolding.
6. For user-facing flows, run the UX/design advisor (if one exists) before the quality bar gate (see Quick start step 8).
7. Update brain bookkeeping in the same run.
8. Stop after presenting the spec and the recommended next step.

## Advanced features

- Discovery and repo orientation: see [references/discovery.md](references/discovery.md)
- Clarifying-question strategy: see [references/questioning.md](references/questioning.md)
- Domain and folder naming rules: see [references/folder-naming.md](references/folder-naming.md)
- Acceptance-criteria and quality bar: see [references/spec-quality-bar.md](references/spec-quality-bar.md)
- brain index and log updates: see [references/brain-bookkeeping.md](references/brain-bookkeeping.md)
- Review closeout and next-step routing: see [references/handoff.md](references/handoff.md)

## Project Advisors

Project-specific advisor agents detected by init-brain (or added manually). When a trigger below matches, delegate via the `Agent` tool with `subagent_type: "<agent-name>"` and brief it self-contained.

<!-- init-brain:advisors:start -->
_No project advisor agents detected. If this project defines agents under `.claude/agents/` or `.agents/agents/`, list each here as: **`<name>`** — trigger — when to delegate._
<!-- init-brain:advisors:end -->
