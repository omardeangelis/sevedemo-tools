---
domain: _root
type: index
links: []
created: 2026-06-12
updated: 2026-06-12
---

# Constitution — Spec-Driven Implementation Rules

Repo-level rules and sanity checks that every spec-driven skill (`create-spec`, `create-plan`, `implement-spec`, `docs-maintenance`) must respect. Keep this short and **edit it to match your stack** — the TODO blocks below are placeholders.

## Non-negotiables

- Specs live in the problem space: they define the *what* and *why*, never the *how*.
- One `SPEC.md` maps to one capability/epic; when child stories exist, their requirements are unified beneath it.
- No code is written during `create-spec` or `create-plan`. Implementation happens only in `implement-spec`.
- Tests describe behavior through public interfaces (see `tdd`). No horizontal slicing (all-tests-then-all-code).
- Persistent implementation drift is tracked in `tech-debt/<domain>/<spec>.md`, not buried in spec folders.
- Domain knowledge in `domains/` is written by `docs-maintenance`, not hand-authored.

## Project sanity checks

> Fill these in for your project. Examples:
> - Run `<typecheck/test/lint command>` before declaring a task done.
> - Schema/migration changes are reviewed by `<advisor agent>` before being written.
> - The API contract is the source of truth for the generated client.

- TODO: add your project's build / test / lint gates.
- TODO: add your project's review gates and ownership boundaries.
- TODO: add any contract or codegen chain that must not be bypassed.
