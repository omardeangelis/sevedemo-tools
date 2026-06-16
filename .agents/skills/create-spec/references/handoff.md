# Handoff

Use this reference after the spec and brain bookkeeping are complete.

## Complexity assessment

Classify the change before recommending the next step.

### Trivial / straightforward

- small and well-scoped
- clear acceptance criteria
- few unknowns
- low architectural risk
- limited surface area

Recommendation:

- suggest direct implementation

### Non-trivial

- multiple moving parts
- unclear dependencies
- architectural choices still matter
- risk of breaking existing behavior
- open questions remain about the approach

Recommendation:

- suggest `create-plan`

## User-facing closeout

Tell the user:

- where the spec was created (and that a companion `FLOW.md` was written, if `ux-advisor` produced one)
- that the spec passed the `adversarial-verifier` quality gate, and any BLOCKER it raised was resolved (if the gate was run)
- that brain index and log were updated
- that the spec is ready for review
- the suggested next step

Then ask them to reply with:

- `[P]` to create an implementation plan
- `[I]` to implement directly

Then stop and wait. Do not proceed until the user approves the spec and picks a next step.
