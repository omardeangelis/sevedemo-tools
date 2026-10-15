# The prototype reviews and the `FLOW.md` map

Use this reference when the spec starts from an approved `prototype` winner that `ux-advisor`, `ui-reviewer`, or both reviewed. `prototype` Phase 6 runs them in parallel on the winner. One owner per concern:

> UX → `ux-advisor` · static UI of the rendered page → `ui-reviewer` (bar and probes: the `ui-review` skill) · motion and interaction craft → `design-engineer` (`design-engineering`)

Two rules hold throughout:

- **`SPEC.md` is the only acceptance contract.** Everything a review asks for that the spec adopts becomes an acceptance criterion there.
- **`FLOW.md` is a map, not a second contract.** It shows where each criterion lives in the flow. Every requirement in it cites an acceptance-criterion id; a requirement stated only in `FLOW.md` is a defect, and the verifier ignores a row with no id.

`create-spec` never spawns `ux-advisor` or `ui-reviewer`: it reads the reviews they already returned.

## Where the reviews come from

- **In context:** `prototype` Phase 6 opened this run right after the reviews.
- **`UX-REVIEW.md` and `UI-REVIEW.md`:** the user stopped between the reviews and the spec, so `prototype` saved each one next to the surviving variant (`UI-REVIEW.md` next to `UX-REVIEW.md`). Read them from the cited prototype path. They are deleted with the prototype surface.

Either review can be missing: `prototype` skips an agent that is not installed. Fold in the one you have.

No UX review means no `FLOW.md`, even when a UI review exists. Do not write one from your own reading of the prototype.

Number the acceptance criteria (`AC1`, `AC2`, …) so `FLOW.md` can cite them.

## Fold the UX review into `SPEC.md`

| Review section | Goes to |
|---|---|
| Verdict | one line in Context: the verdict and the review date |
| Prototype changes (applied in the iterate loop) | Decision Log, each with its exact values: decisions already taken, like the winner's own |
| Decisions | one acceptance criterion each, from the review's criterion text. P0 and P1 stay unless the user overrules them; a P2 the user drops goes to Non-Goals |
| Task accessibility fixes | **one** criterion that lists them, one line each with its location |
| Outcomes and states | each `missing` or `not reachable` row with a consequence is already a decision. A row whose outcome is a business fact nobody has decided becomes an open question |
| Leaving and interrupting | each row is already a decision; the rows that behave are not listed |
| Persona situations and dependencies | Context names the personas. A dependency on another flow, feature or data goes to Constraints, or to Open Questions when it is unresolved |
| Already broken around the surface | a criterion when the spec must fix it; otherwise Technical Notes, or Non-Goals with the reason |
| Where the spec will be misread | tighten the wording of the criteria it names |
| Manual checks still needed | Constraints ("verified manually: …"), so the plan schedules them |
| Open questions | Open Questions, each row with the recommended default |

Do not copy anything else from the review into the spec: the evidence stays in the review.

## Fold the UI review into `SPEC.md`

| UI review section | Goes to |
|---|---|
| Verdict and Engines | one line in Context, next to the UX verdict: the verdict, the engines and widths it measured, and the review date |
| Decisions | one acceptance criterion each, as for UX, from the review's criterion text. P0 and P1 stay unless the user overrules them; a P2 the user drops goes to Non-Goals |
| Mechanical fixes | **one** criterion that lists them, one line each with its location |
| Not verified on device | Constraints ("verified manually on device: …"), each with its manual check, so the plan schedules them |
| Open questions | Open Questions, each row with its default |
| Prototype changes (applied in the iterate loop) | Decision Log, each with its exact values |
| Checked and clean, Not tested | not copied; the evidence stays in the review |

UI criteria keep the review's width range, state and engine, so the plan and the review pipeline can check them on screen.

## One defect, one criterion

Both reviewers can report the same defect: `ux-advisor` by what the person cannot do, `ui-reviewer` by what the page measures. Before numbering, pair the findings that name the same element (the same control or region, in an overlapping state or width range).

**Merge rule:** A UX finding and a UI finding on the same element become one criterion. The UI wording carries the cause and the fix; the UX wording carries the task consequence.

- The merged criterion takes the higher priority of the two.
- It replaces both: no second criterion names that element for the same defect.
- When the two reviews disagree on what to do, ask the user; the default is the UI review's fix.

> **AC4.** In the filters bar, Apply stays on the first row at 280–1440 px (today the chips wrap at 412–468 px and push it under the results header; let the chips scroll sideways and keep Apply at the end of the row), so a person who changes a filter at any width can find Apply and see the results update.

## `FLOW.md` and UI criteria

`FLOW.md` stays a flow map: UI criteria need no row in it. A merged criterion is cited where its UX consequence sits in the flow. Never add a row for a width range, a ratio or a focus ring alone.

## Rejected findings

A rejected finding is dropped from the spec. Offer to append it, as one line (the finding, where it was, and why the project rejected it), to the **Suppressed findings** of the page its reviewer reads before every review, so the same finding does not come back:

- **A UX finding** → `brain/chore/ux-review.md`. Create the page on first use, with three sections: **Component traps** · **Kept examples** · **Suppressed findings**.
- **A UI finding** → `brain/chore/ui-review.md`. Create the page on first use, with four sections: **Project bar** · **Component traps** · **Kept examples** · **Suppressed findings**.
- **A merged finding** → each half to its reviewer's page.

Both pages use the base frontmatter with `domain: _root`, `type: concept`. When the page exists without the section, add the section in its place.

**The Project bar is the user's.** It holds the minimum width, the target-size standard, the engines and devices the project supports, and the design-system rules the review enforces. Offer to start it; never fill it in, and never copy a value from the review into it. Until the user writes it, `ui-reviewer` uses its defaults. A new `brain/chore/ui-review.md`:

```markdown
---
domain: _root
type: concept
links: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# UI review: project knowledge

Read before every UI review: by `ui-reviewer`, and by the UI pass of `adversarial-review` through the `ui-review` skill.

## Project bar

_Yours to write: minimum width, target-size standard (24 px by default; 44 or 48 px when the project is touch-first), the engines and devices you support, and the design-system rules the review enforces. Until then the reviewer's defaults apply._

## Component traps

## Kept examples

## Suppressed findings

- <the finding> · <where: selector, state, width range> · <why the project rejected it> (YYYY-MM-DD)
```

## `FLOW.md` template

Write it at `brain/specs/<domain>/<spec>/FLOW.md`, in about 150 lines at most. Keep only user-observable behavior: no component names, no data-fetching, no implementation detail (those belong in `PLAN.md`).

```markdown
# Flow map: <feature>

> Map of [[specs/<domain>/<spec>/SPEC]]. Every requirement cites an acceptance criterion there; `SPEC.md` is the contract.
> Source: `ux-advisor` review of the prototype at `<path>` (`<route>`), <date>, verdict `<verdict>`.

## Goal
<the user goal and the signal that proves it worked, in one sentence> (AC…)

## Persona situations
- <segment from the personas page> × <entry point> × <permissions> × <device> × <data volume> × <prior knowledge> — what differs for them here (AC…)

## Entry points
- <where and how the user arrives; preconditions; role> (AC…)

## Happy path
1. <user intent> → <visible system response> (AC…)
→ Outcome: <the observable success state> (AC…)

## States
| Action or region | Outcome, state, or interruption | Criterion |
|---|---|---|
| <action> | success | present |
| <action> | uncertain (timeout after send) | AC3 |
| <action> | closed while saving | AC4 |
| <region> | empty | open question 2 |

## Accessibility
- Keyboard path of each primary task: where focus goes after each action; dialogs and menus: focus moves in, Tab stays inside, Escape closes, focus returns (AC…)
- Announcements of each outcome (AC…)
- Task accessibility fixes (AC…)
- Manual checks still needed: <screen-reader steps>

## Persona dependencies
- <hand-off: one persona's action creates a state another must see> (AC…)
- <dependency on another flow, feature or data> (AC… or open question #)
```

Fill rules:

- **Happy path:** at most 10 steps.
- **States:** one row per outcome, state, or interruption from the review. A `present` row needs no id; any other row cites the criterion that settles it, or the open question.
- **Persona situations:** only where situations differ. Use the segments in `<personas>` verbatim; when `paths.personas` is `null`, describe the roles and point to the open question.
- **Every bullet ends with an id.** If one has no criterion behind it, either add the criterion to `SPEC.md` or delete the bullet.

## Older `FLOW.md` files

Files written before this format (sections Personas · Error paths · Edge cases · Friction notes) stay as they are. Readers accept both. Rewrite one into this shape only when its spec is revised.
