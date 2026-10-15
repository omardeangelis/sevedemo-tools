---
name: docs-maintenance
description: Ingest a spec folder into the brain domain layer by extracting and writing flow pages first, then concept pages, then syncing ingest metadata. Use when a spec is ready to be captured as domain knowledge after review or implementation.
---

# Docs Maintenance

## Contract

- **Role:** higher-order ingest and repo-docs orchestrator
- **Entrypoint type:** public entrypoint
- **Upstream:** reviewed or implemented spec folder, or code changes that may require `brain/` updates
- **Delegates to:** internal flow-writing phase, then internal concept-writing phase
- **Downstream:** synced brain indexes, ingest metadata, brain log, and any required updates to the tech-debt store (`<techDebt>/`)
- **Entry conditions:** resolved spec folder for ingest work, or a concrete docs-affecting code change
- **Stop conditions:** ingest bookkeeping complete, required docs updates complete, failures reported honestly

## Overview

**Primary purpose:** synthesize `brain/specs/<domain>/<spec>/SPEC.md` (and optionally `FLOW.md` and `IMPLEMENTATION-NOTES.md`) into the brain domain knowledge layer. Write flow pages first, then concept pages, then sync ingest bookkeeping.

**Secondary purpose:** ingest the review reports produced by `adversarial-review` (`REPORT.md`). Reviews are not synthesized into flow/concept pages: their durable findings are folded into the tech-debt store, the review is backlinked, and it is marked ingested. See `## Secondary: Review Ingest` and [references/review-ingest.md](references/review-ingest.md).

Read `brain/AGENTS.md` before touching any brain content. Read `brain/brain.config.json` (keys in `brain/AGENTS.md` → Project configuration). If it is absent, use the defaults listed there: `<techDebt>`, `<reviews>` and `review.location` below come from it.

---

## Primary: brain Ingest Orchestration

### Pipeline

```
docs-maintenance (orchestrator)
  └─ 1. flow-writing phase    — writes flows/, updates domain index
  └─ 2. concept-writing phase — reads flows/ for cross-linking, writes concepts/, updates domain index
```

**Why this order is required:** concept writing reads existing flow pages to cross-link concepts. Flow pages must exist before concept pages are written.

### Inputs

Accept any of:
- A spec folder path: `brain/specs/<domain>/<spec>/`
- A domain name + spec name
- An explicit `SPEC.md` path
- A review folder or `REPORT.md` path (`<reviews>/<slug>/`, `<reviews>/<domain>/<spec>/`, or a `REPORT.md` in a spec folder with no spec ingest requested) → route to `## Secondary: Review Ingest`

Resolve all inputs to a full spec folder path before continuing. If the target is still ambiguous, ask only for the missing folder. If the target is a review, run the review-ingest path instead of the spec pipeline.

### Step 1: Guard

Check `SPEC.md` frontmatter for `ingested: true`. If set, exit with a clear no-op message.

Verify the spec has `domain:` in frontmatter. Error if absent.

### Step 2: Read the source

Read in order:
1. `SPEC.md` — mandatory. If missing, stop and report.
2. `FLOW.md` — optional. The flow map `create-spec` wrote from the `ux-advisor` review of an approved prototype. When present, it is the primary, pre-structured source for flow extraction (Step 3); prefer it over re-deriving flows from acceptance criteria, and reconcile it with `IMPLEMENTATION-NOTES.md` deviations where they conflict. Its requirements cite `SPEC.md` acceptance criteria; the spec stays the source of truth.
3. `IMPLEMENTATION-NOTES.md` — optional. If present, flows and concepts become `status: implemented`. If absent, status is `proposed`.
   - Check its frontmatter. If it lacks frontmatter (no YAML block), add it now before continuing:
     ```yaml
     ---
     domain: <domain from SPEC.md>
     type: implementation-notes
     spec: <spec id from SPEC.md>
     links:
       - "[[specs/<domain>/<spec>/SPEC]]"
     ingested: false
     last_ingested: null
     created: <today>
     updated: <today>
     ---
     ```

4. `REPORT.md` — optional. The spec's review in its review folder: `brain/specs/<domain>/<spec>/REPORT.md` under `review.location: spec-folder`, `<reviews>/<domain>/<spec>/REPORT.md` under `review-tree`. When present with `ingested: false`, it is a supplementary source like `IMPLEMENTATION-NOTES.md`: its confirmed durable findings go to the tech-debt store and its backlink is added to the pages written below. Do **not** turn review findings into flow or concept pages. Process it per `## Secondary: Review Ingest` (Steps 7–8 mark and log it).

Verify `brain/domains/<domain>/` exists with a `<domain>.md` index file. If the domain is missing, scaffold it first: create `brain/domains/<domain>/` with a `<domain>.md` domain map and a `<domain>-contract.md` (sections **Owns**, **Does Not Own**, **Invariants**), plus empty `concepts/`, `flows/`, and `decisions/` subfolders. Then continue.

### Step 3: Extract flows

A flow exists when the spec describes a **sequence of user or system actions with a defined start, steps, and end outcome**.

**If `FLOW.md` is present, it is the primary flow source.** Its sections map directly:
- **Current format:** `Goal` → the terminal outcome, `Persona situations` → the actors, `Entry points` → the triggers, `Happy path` → the main step sequence, `States` → branch and recovery steps (only the cells that cite a criterion), `Accessibility` → annotations on the steps, `Persona dependencies` → links to the other flows they touch.
- **Older format:** `Goal`, `Personas`, `Happy path`, then `Error paths` → branch and recovery steps and `Edge cases` → annotated edge handling.

Carry the states and recovery branches into the flow page, not only the happy path. Use the search heuristics below only to catch flows `FLOW.md` did not cover, or when no `FLOW.md` exists.

Look for flows in:
- Multi-step acceptance criteria (e.g. "On save, the system runs duplicate detection → blocks if exact match → redirects operator on success")
- Explicit user journeys or process descriptions in the Context section
- "When X, then Y" conditional chains across multiple acceptance criteria
- Any section titled Flow, Process, Journey, or similar

For each flow found:
- Assign a descriptive `flow_name` (e.g., "Create Patient", "Document Upload", "Duplicate Check")
- Extract `flow_content`: triggering event, actors involved, ordered steps with decision points, terminal outcome
- When `IMPLEMENTATION-NOTES.md` is present: note deviations, surprises, or blocked steps inline

If no multi-step sequence is discernible (e.g., a purely data-model spec), record the absence and skip flow delegation.

### Step 4: Write flow pages

Read [references/flow-pages.md](references/flow-pages.md) and apply that contract to every extracted flow.

Wait for all flow pages to complete before proceeding.

If any flow write fails, stop immediately. Do not proceed to concept writing. Report the failure so the run can be resumed cleanly.

### Step 5: Extract concepts

A concept exists when the spec **names a domain entity or term with defined attributes, invariants, or bounded scope**.

Look for concepts in:
- Fields listed in acceptance criteria (e.g., `first_name`, `email`, `acquisition_channel`, `nin`)
- Explicit data model or entity sections
- Nouns that recur across multiple acceptance criteria with their own distinct attributes or rules
- Enum sets representing a bounded domain state (e.g., `acquisition_channel` values)
- Entities referenced via `[[brainlinks]]` to other specs or domain pages

**Grouping rule:** collect related fields under one owning entity rather than creating a concept per field. All patient registry fields → one "Patient" concept. All acquisition channel variants → one "Acquisition Channel" concept.

If no distinct domain entity is identifiable, record the absence and skip concept delegation.

### Step 6: Write concept pages

Read [references/concept-pages.md](references/concept-pages.md) and apply that contract to every extracted concept.

Wait for all concept pages to complete.

### Step 7: Mark sources as ingested

Update `SPEC.md` frontmatter:
```yaml
ingested: true
last_ingested: YYYY-MM-DD
```

If `IMPLEMENTATION-NOTES.md` is present, update its frontmatter:
```yaml
ingested: true
last_ingested: YYYY-MM-DD
```

Also populate its `links` array with every flow and concept page written in Steps 4 and 6 (in addition to the SPEC link that was set in Step 2). This is the only moment where IMPLEMENTATION-NOTES links are updated — do not leave them pointing only at the SPEC.

If a sibling `REPORT.md` was found in Step 2 with `ingested: false`, process it now per [references/review-ingest.md](references/review-ingest.md): fold its durable findings into `<techDebt>/<domain>/<spec>.md`, backlink `[[<folder>/REPORT]]` into the flow/concept pages it bears on (and into the IMPLEMENTATION-NOTES `links`), then set its frontmatter `ingested: true` / `last_ingested: YYYY-MM-DD`. Never set `ingested: true` on a review report any other way.

### Step 8: Log entry

Append to `brain/log.md` (cap at 50 entries; drop oldest when over):
```md
## [YYYY-MM-DD] ingest | <spec title>
- Source: [[specs/<domain>/<spec>/SPEC]]
- Flows written: <count>
- Concepts written: <count>
- Review ingested: [[<folder>/REPORT]] | none
```

### Step 9: Update brain index

If new pages were created, update the Concepts and Flows counts in the relevant Domains table row in `brain/index.md`.

### Resumability

Output pages are the checkpoints. On re-invocation of the same source:

- Flow pages with `ingested: true` → skip Step 4 for those flows
- Any expected flow page missing → re-run Step 4 for it before Step 6
- Concept pages with `ingested: true` → skip Step 6 for those concepts

---

## Secondary: Review Ingest

Adversarial review reports (`REPORT.md`), produced by the `adversarial-review` skill, are ingested differently from specs: their findings are **not** synthesized into domain flow/concept pages. A review is a point-in-time quality judgment, not durable domain knowledge — so ingest folds its lasting findings into the tech-debt store, backlinks it, marks it ingested, and logs it.

Two triggers:

- **Alongside a spec (case B).** When ingesting `brain/specs/<domain>/<spec>/`, Step 2 finds the spec's `REPORT.md` in its review folder (per `review.location`). It is processed in the same run (Step 7).
- **Standalone (case A).** When invoked directly on `<reviews>/<slug>/REPORT.md`, run only the review-ingest path — there is no spec to synthesize.

Full contract: [references/review-ingest.md](references/review-ingest.md). In short:

1. **Guard** — if the report's frontmatter has `ingested: true`, exit with a no-op message.
2. **Read** the report. Identify findings marked durable (`Durable? = yes` — confirmed BLOCKER/MAJOR not fixed before ship).
3. **Fold durable findings** into `<techDebt>/<domain>/<spec>.md` (case B) or `<techDebt>/<domain>/<slug>.md` (case A; use the report's `domain`, or `_unscoped`). Create the file if absent; append, never overwrite.
4. **Backlink** — case B: add `[[<folder>/REPORT]]` to the flow/concept pages the findings bear on and to the IMPLEMENTATION-NOTES `links`. Case A: no domain pages exist to backlink; the tech-debt entry is the anchor.
5. **Mark ingested** — set the report's `ingested: true` / `last_ingested: YYYY-MM-DD`. Never by hand outside this path.
6. **Log** — append a `review-ingest` entry to `brain/log.md`.

---

## Never Do

- Ingest a spec with `ingested: true` — exit early instead
- Ingest an `IMPLEMENTATION-NOTES.md` with `ingested: true` — treat it as already reflected in domain pages
- Ingest a `REPORT.md` with `ingested: true` — treat its findings as already folded into the tech-debt store
- Synthesize review findings into flow or concept pages — reviews fold into the tech-debt store and backlinks only
- Proceed to concept writing when a flow write has failed
- Document speculative or future-state features as current truth
- Put agent task instructions inside human-facing docs pages
