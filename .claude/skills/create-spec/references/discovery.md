# Discovery

Use this reference before asking clarifying questions.

## Required order

1. Read `brain/AGENTS.md`.
   - Stop if it does not exist. The brain is not bootstrapped yet.
2. Read `brain/index.md`.
   - Use it as the master map for domains, contracts, and existing specs.
3. Identify the primary domain.
   - Prefer the domain whose contract most clearly owns the request.
   - If multiple domains are involved, pick the primary owner and note cross-domain scope in the spec.
   - If no domain matches, stop and tell the user to scaffold the domain folder under `brain/domains/<domain>/` (domain map + contract) first.
4. Read the relevant domain contract:
   - `brain/domains/<domain>/<domain>-contract.md`
5. Optionally read related domain concepts or flows when they are obviously relevant.
6. Check for existing overlapping specs in:
   - `brain/specs/<domain>/<domain>-specs.md`
7. If backlog context exists, inspect the parent epic/capability and every child story beneath it.
   Use your backlog / issue tracker as the source of truth for how to interpret module -> epic -> story shape.
   Harvest:
   - epic outcome and constraints
   - each child story title
   - each child story body and acceptance signals
   - cross-story blockers or sequencing assumptions that affect the problem statement
8. Check existing DB schema when a matching domain schema file exists in the data/schema layer (`<app-or-package-path>`).
   Use it to:
   - avoid speccing duplicates
   - catch contradictions with the implemented model
   - surface open questions when a required field is absent
9. Glance at the top-level repo structure only if needed for terminology or context.

## Exploration rule

This is orientation, not deep implementation research.

- Keep it read-only
- Keep it fast
- Prefer enough context to ask better questions
- Do not drift into solution design

If the Agent tool is available, use a subagent for this pass so the main thread stays clean.
