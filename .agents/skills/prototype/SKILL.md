---
name: prototype
description: Build multiple genuinely different versions of a UI piece you describe, rendered behind a visual picker so you can flip through them live and promote the one that feels right. Only runs when explicitly invoked; it does not trigger on its own.
disable-model-invocation: true
---

# Prototyping Variants

A divergence skill. It does ONE thing: take a described piece of UI ("a toast", "the pricing card", "a hold-to-delete button"), build several genuinely different versions of it, and put them behind a visual picker so the user can flip through them live and choose a winner. It does not review existing UI, plan fixes for it, or choose dependencies — for motion and interaction craft those are the `design-engineer` agent's modes (review, audit, opportunities, library pick), backed by the `design-engineering` skill, and the static UI of a rendered page is `ui-reviewer`'s.

## Contract

- **Role:** UI divergence explorer — builds N genuinely different variants of one described piece behind a visual picker
- **Entrypoint type:** public entrypoint, **explicit invocation only** (`disable-model-invocation: true`) — never auto-triggered by a routing table. Other skills and agents may *suggest* a run; only the user invokes it.
- **Upstream:** the user describing a UI piece to explore; open visual/interaction questions surfaced during `create-spec` / `create-plan` (the flow suggests a run, the user invokes it)
- **Delegates to:** nothing while exploring — single-thread by design; consults the project's design knowledge during recon (root `AGENTS.md`, `brain/chore/`, the shipped **`design-engineering`** skill as the craft bar, and any brand or frontend-design skill the project ships — see "In a brain project"), and may brief the **`design-engineer`** agent for a motion review of the variants before presenting them. Once the user approves a winner, it spawns the **`ux-advisor`** and **`ui-reviewer`** agents in parallel to review it (Phase 6) — the only point in the flow that spawns them
- **Downstream:** `create-spec` — the winner is never integrated by hand: its direction and exact values (easing, durations, layout, states, copy) and the decisions of the `ux-advisor` and `ui-reviewer` reviews enter `SPEC.md` (the UX ones also its `FLOW.md` map), then `PLAN.md`, and production code is written by `implement-spec` under the project's own coding standards
- **Precedence:** consumer of the project's design corpora — brand/identity rules win on color and typography, motion standards (the `design-engineering` skill, under the project's own tokens and documented motion decisions) win on anything motion, layout/aesthetic direction comes from the project's frontend-design guidance when it exists. Divergence never lowers their bars.

## Operating Posture

You are a senior design engineer running a design exploration. The entire value of this skill is **divergence**: three tints of the same idea waste the picker — the user learns nothing by flipping between them. Each variant must be a direction you could defend shipping on its own, exploring a genuinely different answer to the same brief.

Divergence is not an excuse to drop the craft bar. Every variant individually meets the `design-engineering` standards (`design-engineering/references/standards.md`): a strong custom curve from the right family (ease-out family on entrances, never ease-in, never a bare keyword), product UI motion under ~300ms unless the element's size, its travel, or a steep curve justifies more, exits shorter than entrances, `transform-origin` at the trigger (modals centered), no `scale(0)`, `transform`/`opacity` only, interruptible where re-triggerable, and a reduced-motion variant that keeps the meaning and drops the travel. A sloppy variant doesn't widen the exploration; it just loses on execution and teaches nothing about the direction it represents.

## Hard Rules

1. **Never touch production code.** Everything lives in an isolated prototype surface (see Phase 4) — during exploration *and* after the choice. Phase 6 hands the winner to the implementation flow; it does not integrate it.
2. **Variants diverge on a named axis** — layout, density, personality, motion, interaction model. Before building, you must be able to state each variant's axis in a phrase. Sharing the project's tokens is not convergence; variants *should* feel native to the product.
3. **Every variant fully works.** Real interactions, real motion, realistic content — actual product-shaped copy, plausible names and numbers. No lorem ipsum, no dead buttons, no "imagine this part".
4. **The picker is chrome, not a contestant.** Its exact markup, styles, and behavior are specified in [PICKER.md](PICKER.md) — copy them verbatim. Its look is not a design decision and never adapts to the project.
5. **Clean up after the choice.** When a winner is promoted, delete the prototype surface unless the user asks to keep it — at the latest when the real implementation lands (see Phase 6).

## Workflow

### Phase 1 — Scope

One thing per run. If the description spans multiple components ("the dashboard"), narrow it: pick the single highest-leverage piece, say which and why, and offer the rest as follow-up runs. Restate the brief in one sentence — what the thing is, where it will live, what it must do.

**Where it lives is not yours to guess.** A brief that names the piece but not the screen ("the recent-searches list", a contract, a spec) can fit several routes, and a variant built against the wrong surrounding context teaches nothing. If the user has not given the route (or page/file for the standalone branch), find the candidate screens during Phase 2 recon, then **ask for confirmation of the route before Phase 3** — name each candidate with its path and one line on why it fits, and recommend one. Use your tool's structured question mechanism when it has one (in Claude Code, `AskUserQuestion` with the candidate routes as options, the recommended one first). Do not start building on a guess. Skip the question only when the brief names the route or the piece exists on exactly one screen.

**Feel before directions.** Two more facts bound the exploration; read them before asking. *Frequency* — how often one user meets this piece (usually clear from the code and the route) — decides whether motion may be an axis at all. *Personality* — usually written in `brain/chore/` or the root `AGENTS.md`. When personality isn't written down and the brief doesn't state it, ask the way `design-engineering/references/motion-brief.md` does: **a reference product whose version of this feels right**, or, failing that, a binary choice between businesslike-and-crisp and friendly-with-some-bounce, with your recommendation first. Never ask the user for durations or curves — propose them. One question at a time, the route question first.

### Phase 2 — Recon

Before designing anything, map the ground the variants must stand on:

- **Stack**: framework, styling system (Tailwind, CSS modules, vanilla), motion library if any.
- **Tokens**: colors, radii, spacing, fonts, easing/duration variables. Variants use these — every variant should look like it could ship in this product tomorrow.
- **Personality**: playful consumer app or crisp dashboard? This bounds how far the boldest variant may go.
- **Context**: where the piece renders — against what background, beside what neighbors, at what sizes.
- **Motion ground**: existing easing/duration tokens, the motion and primitive libraries (origin variables, enter/exit attributes), and whether reduced motion is handled globally. Each variant's tool follows `design-engineering/references/library-pick.md` — in-project, only what is already installed; standalone, CSS by default and a library only for a variant that genuinely needs springs, layout morphs, or drag momentum.

If there is no project (empty directory, or the user is just exploring), skip to the standalone branch in Phase 4 and choose a restrained default look: neutral grays, one accent, system font stack.

### Phase 3 — Choose directions

Default **3 variants**; up to 5 when the user asks or the design space is genuinely wide. More than 5 dilutes the comparison.

Before writing any code, list the set: a name and an axis for each. Names describe the direction — "Quiet", "Editorial", "Playful", "Dense" — never "Option A/B/C". If two proposed directions would differ only in accent color or copy, they are one direction; replace one with a real alternative (different layout, different interaction model, different motion story).

Run the gate before motion becomes an axis (`standards.md` §1). For a keyboard-driven or 100+/day piece the motion axis is closed — every variant is instant, and the set diverges on layout, density, or interaction model instead; say so. When motion *is* the axis, a restrained direction (instant, or opacity-only) is a legitimate variant: if it wins, that is an answer.

Give every variant a **motion line** with exact values — trigger → properties, curve, duration (justified past 300ms), interrupt behavior, reduced-motion variant — e.g. `open: scale(0.98)→1 + opacity, 240ms var(--ease-out-expo), transition (interruptible); reduce: opacity only`. These are the numbers Phase 6 hands to the spec, so they must be the ones the variant actually runs.

**Completion criterion:** every variant has a name, a stated axis, and a motion line with exact values, and no two variants share an axis position.

### Phase 4 — Build the picker harness

Two branches, by what exists:

- **In a project with a dev server** — an isolated route or page (`/prototypes/<slug>`, or the framework's equivalent), one file per variant plus a small harness file. Nothing imports from the prototype surface into production code.
- **No project / static context** — a single self-contained HTML file (inline CSS/JS) the user can open directly in a browser.

The picker's markup, styles, keyboard wiring, and placement come from [PICKER.md](PICKER.md), verbatim — load it now and build exactly that. Beyond the picker itself, the harness must render **one variant at a time, full size, in realistic surrounding context** — a toast needs a page behind it, a card needs siblings, a button needs a form. Side-by-side thumbnails distort spacing and scale; never judge UI at postage-stamp size. Switching is **instant** — flipping is a 100+/session action; by the frequency rule the variant swap gets no animation. Each variant implements its own reduced-motion variant, so the whole harness can be flipped with `prefers-reduced-motion: reduce` emulated.

### Phase 5 — Verify and hand off

Run the harness. Confirm every variant renders, every interaction responds, and the console is clean — flip through all of them yourself before showing the user. Then the feel-checks (`design-engineering/references/standards.md` §11): replay each variant's motion slowed down (DevTools Animations panel at 10–25%) to catch wrong origins, late fades, and out-of-sync properties, then at full speed; flip through every variant again with `prefers-reduced-motion: reduce` emulated — nothing should travel, the meaning should survive. Gesture variants need a real device (dev server over the local IP); when you can't run that, say so in the hand-off. If browser tooling is available (`$agent-browser` or the tool's own browser), screenshot each variant. Before the first `agent-browser` command, run `agent-browser skills get core` and follow it: it is the usage guide for the installed version.

Then present the set and **stop — the choice belongs to the user**:

| # | Variant | Axis | Motion | When it's the right choice | Its cost |
| --- | --- | --- | --- | --- | --- |
| 1 | Quiet | Minimal motion, borders over shadows | opacity only, 150ms `ease` | The product is a daily-use tool | Least memorable |
| 2 | Editorial | Large type, generous whitespace | `scale(0.98)`→1 + opacity, 240ms `--ease-out-expo` | The moment deserves weight | Eats vertical space |

Close with where the picker is running (URL or file path), the keys to flip, and any feel risk you could not verify (a gesture not tried on a device, a crossfade that may read as two objects).

**Completion criterion:** every variant is reachable from the picker and behaves correctly, at full speed and with reduced motion emulated; no console errors; the table names each variant's motion and tradeoff honestly.

### Phase 6 — Hand the winner to the implementation flow

A chosen variant is an **answer to a design question**, not a feature ready to ship: it runs on a fake state machine, invented copy, and no backend contract. Writing it straight into production code skips every gate the project has — spec, plan, review.

So, when the user picks, do exactly three things:

1. **Reduce the surface to the winner.** Delete the losing variants and the picker (with one variant left it has nothing to switch between); keep the winning variant reachable at its prototype route. It stays the live reference the spec points at.
2. **Have the winner reviewed, for UX and for static UI, by two reviewers at once.** One owner per concern:

   > UX → `ux-advisor` · static UI of the rendered page → `ui-reviewer` (bar and probes: the `ui-review` skill) · motion and interaction craft → `design-engineer` (`design-engineering`)

   Spawn the **`ux-advisor`** and **`ui-reviewer`** agents in parallel, on the winner only: the losing variants competed on direction, not polish. Each drives its own `agent-browser` session, named in its brief — `--session ux-<slug>` and `--session ui-<slug>`, never the default one. Brief both self-contained with:
   - the winning variant: its path, and the URL of its dev route (or the file URL of the standalone HTML);
   - the scope from Phase 1;
   - the winner's values: its motion line with exact values, and the layout, states and copy it settled on;
   - what the prototype fakes (endpoints, data, permissions);
   - its session name.

   Add for `ux-advisor` the personas path (`paths.personas` in `brain/brain.config.json`; `null` when the project has none). Add for `ui-reviewer` the project's UI bar: `brain/chore/ui-review.md` (its Project bar sets the widths, the target size and the engines), or the note that the project has none, so the agent's defaults apply.

   **When an agent can't run:**
   - if `ui-reviewer` is not installed, skip it and say so; the same holds for `ux-advisor`;
   - if your tool cannot spawn subagents, run each charter inline (`.agents/agents/ux-advisor.md`, `.agents/agents/ui-reviewer.md`), one after the other, each on its own session.

   **One combined verdict.** Wait for both reviews, then relay one verdict to the user in one line: the stricter of the two (`iterate` over `proceed with decisions` over `proceed`), naming each reviewer's own. With one reviewer skipped, its partner's verdict stands alone. Then:
   - `proceed` or `proceed with decisions` → step 3, passing both reviews on;
   - `iterate` → run the iterate loop below, then step 3.
3. **Enter the project's implementation flow with `create-spec`.** The prototype is the *input* to that flow: carry over its direction and its exact values — easing, durations, layout, states, copy — as spec decisions (the winner's motion line, expanded into a motion brief per `design-engineering/references/motion-brief.md`), pass both reviews on (their decisions become acceptance criteria), and note what the prototype faked (endpoints, permissions, real data) as the open questions the spec must answer. The prototype surface gets deleted per Hard Rule 5 only when the real implementation lands.

**The iterate loop** — one loop for both reviewers, at most 2 rounds:

1. Show the proposed changes from both reviews' Prototype changes, each labelled with its reviewer (finding → change → how to check it on screen). The user picks at most 3 per round, from both reviews; use your tool's structured question mechanism when it has one.
2. Apply the accepted ones to the winner yourself, under the Hard Rules: the isolated surface only, never production code. No agent edits the prototype.
3. Brief both agents again, in parallel, each on its own session. The agent whose items changed re-reviews them, and **both** run their regression pass, because a copy fix can re-wrap a row and a hit-area fix can move focus:
   - `ux-advisor` reruns the task walk, the outcomes, and leaving and interrupting;
   - `ui-reviewer` re-runs the probes on the changed elements and on every class it had reported Checked and clean.

   Relay the new combined verdict, the stricter of the two.
4. After the second round, go to step 3 regardless. The applied changes enter the spec as decisions already taken, with their exact values, like the winner's own.

**If the user stops after the reviews**, save the latest of each verbatim next to the surviving variant: the UX review as `UX-REVIEW.md`, and the UI review as `UI-REVIEW.md` next to `UX-REVIEW.md`, so `create-spec` can pick them up from the cited prototype path later. Both are deleted with the prototype surface.

Never write production code directly from Phase 6, even when the variant looks finished. If the user explicitly asks for a direct integration anyway, say what the spec flow would have caught, then do it.

If the user instead wants another round, keep the harness and run Phase 3 again, diverging *around* the direction they gravitated to.

## In a brain project

How the phases above bind to the brain / spec-driven workflow. Everything else is stack-agnostic and identical to the upstream skill (`omardeangelis/design-eng-skills`, `skills/prototype/`); the brain-specific parts are Hard Rule 1, the route-confirmation and feel paragraphs in Phase 1, the motion-ground recon bullet, the gate and motion lines in Phase 3, the feel-checks in Phase 5, Phase 6, the `tune` invocation, and this section — re-apply them when syncing the upstream.

- **Recon (Phase 2) reads the project, not assumptions.** Start from the root `AGENTS.md` (stack, styling system, design-system or component-library pointer, motion library) and `brain/chore/` (tech stack, product description — this is where the product's personality is usually written down). The stack profile `brain/chore/motion-stack.md` says how each motion API is spelled in this stack — in-project variants use it; on a non-React project without one, run `design-engineering/references/stack-adaptation.md` before Phase 3. The shipped **`design-engineering`** skill is the craft bar every variant must meet — load `references/standards.md`, plus `gestures.md`, `scroll.md`, or `implementation.md` as the piece requires; documented motion decisions in `brain/chore/` and the project's tokens win over it. Brand guidelines and a frontend-design skill, if the project ships them, govern color/type and layout. When motion is part of the exploration, brief the **`design-engineer`** agent with the variant set and their motion lines before Phase 5 (review mode, against `references/review.md`).
- **Scope (Phase 1) names who the piece is for.** Read `brain/brain.config.json` (keys in `brain/AGENTS.md` → Project configuration; absent → the defaults there) and take the persona(s) from `<personas>`, using its segment names verbatim. When `paths.personas` is `null`, name the roles affected and say that `ux-advisor` will characterize users generically.
- **Route confirmation (Phase 1):** find candidate routes in the project's router (read `AGENTS.md` for where routes live); present them as options with path + one line each, the recommended one first.
- **In-project branch (Phase 4):** keep the prototype surface in a single folder (e.g. `src/prototypes/<slug>/` — one file per variant plus the harness), exposed as a **dev-only** route (`/prototypes/<slug>`) guarded by the framework's dev flag so it never ships. Put the surface where the project's styling pipeline can see it (a Tailwind `@source` allowlist, a CSS-modules root, …) — markup outside that scope renders **silently unstyled**. Load the project's coding-standards skill before writing framework code, but never let the prototype leak into production imports.
- **Standalone branch (Phase 4):** if `brain/chore/` contains an HTML prototyping kit (a starter file with the real tokens), duplicate it; otherwise write the single self-contained HTML file. Right choice for purely visual/motion pieces; pick the in-project branch when the piece needs the real component library's behavior.
- **Picker in a framework** (per PICKER.md's "idiomatic" clause): a current-variant state + keyed re-mount so switching re-runs entrance animations; refs + a layout effect for the highlight measurement. Classes and values stay verbatim.
- **Promotion (Phase 6) opens the brain flow, not a direct integration:** `ux-advisor` and `ui-reviewer` (review of the winner, in parallel) → `create-spec` → `create-plan` → `implement-spec` → `adversarial-review` (as `review.mode` sets) → `docs-maintenance`. The `SPEC.md` cites the prototype by path and route, inherits its exact values as decisions, and turns the decisions of both reviews into acceptance criteria; `create-plan` turns those values into task targets (`review_mode: browser`); only `implement-spec` writes production code, in the location the project's architecture dictates. The prototype folder and its route are deleted once the implementation lands (Hard Rule 5) — `implement-spec` does that as part of finalizing the spec folder.

## Invocation Variants

| Invocation | Behavior |
| --- | --- |
| `<description>` | Full workflow: scope → recon → 3 variants → picker → wait for choice |
| `<description> x5` | Same, with that many variants (capped at 5) |
| `riff <variant>` | New round: keep the harness, generate a fresh set diverging around the named variant's direction |
| `keep <variant>` | Reduce the surface to that variant, have `ux-advisor` and `ui-reviewer` review it in parallel (one combined verdict; on `iterate`, at most 3 small changes per round chosen from both reviews, at most 2 rounds), then open `create-spec` with the winner and both reviews as input (Phase 6) |
| `keep <variant>, leave the picker` | Same, but leave the losing variants and the picker in place |
| `tune <variant>: <what feels off>` | Diagnose with `design-engineering/references/diagnose.md` (slow it down, name the cause, change one variable), then add the result as a new picker entry beside the original (`Quiet` / `Quiet · tuned`) so the change is judged by flipping, not from memory — the one case where two entries share an axis |

## Tone

Sell each variant honestly — one line on when it wins, one on what it costs. Never pre-pick a favorite in the table; if the user asks which you'd choose, answer with a reason rooted in the product's personality and frequency of use, not aesthetics alone. If two variants converged while you built them, cut one and say so: a picker with two truly distinct directions beats one padded to three.
