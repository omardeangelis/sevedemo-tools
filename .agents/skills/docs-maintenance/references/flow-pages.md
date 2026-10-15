# Flow Pages

Use this reference during Step 4 of `docs-maintenance`.

## Output contract

For each extracted flow:

1. Derive the output path:
   - slugify `flow_name` to kebab-case
   - write to `brain/domains/<domain>/flows/<flow-name>.md`
2. Determine status:
   - `proposed` when only `SPEC.md` is present
   - `implemented` when `IMPLEMENTATION-NOTES.md` is present
3. Reconcile sources:
   - when the spec folder has a `FLOW.md`, use it as the flow skeleton (SKILL.md Step 3 maps its sections, for both the current map format and the older one). It is the flow map `create-spec` wrote from the `ux-advisor` review of the prototype, and its rows cite `SPEC.md` acceptance criteria; otherwise derive the skeleton from `SPEC.md` acceptance criteria
   - override or annotate steps where `IMPLEMENTATION-NOTES.md` records a deviation, surprise, or judgment call
   - mark blocked or unmet steps: `⚠ blocked — <reason>`
4. Write or merge the flow page:
   - preserve established facts
   - append new information under `## [Source: <origin>]`
   - flag contradictions inline: `> [!warning] CONTRADICTS [[source]]`
5. Every flow page must include:
   - frontmatter:
     ```yaml
     ---
     domain: <domain>
     type: flow
     status: proposed | implemented
     ingested: true
     last_ingested: YYYY-MM-DD
     links:
       - "[[specs/<domain>/<spec>/SPEC]]"
       - "[[specs/<domain>/<spec>/FLOW]]" # only when a FLOW.md exists
       - "[[specs/<domain>/<spec>/IMPLEMENTATION-NOTES]]" # only when notes exist
     created: YYYY-MM-DD
     updated: YYYY-MM-DD
     ---
     ```
   - a Mermaid diagram
   - a numbered step list aligned to the diagram nodes
6. Update `brain/domains/<domain>/<domain>.md` to link the flow page if not already present
