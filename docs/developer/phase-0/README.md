# Fastifest — Phase 0: specification and documentation

**Status: approved to proceed; Phase 1 implementation is underway.**

Phase 0 turned the initial brief into a coherent product contract covering behavior, safety boundaries, public interfaces, and acceptance checks. The user approved proceeding to implementation. These documents remain the implementation guide; proposed end-user commands and full-generator examples are not executable until their corresponding phases are completed and verified.

## Review checklist

- [ ] Product scope and v1 limits are right.
- [ ] Configuration and output-path conventions are understandable.
- [ ] Logo selection and screenshot behavior meet the intended workflow.
- [ ] Template execution and trust model are acceptable.
- [ ] Overwrite, stale-output cleanup, and failure behavior are safe.
- [ ] Runtime and release goals are feasible.
- [ ] The consumer-facing guides answer package users' practical questions without exposing internal planning.

## Documents

- [Requirements and decisions](decisions.md) — proposed resolutions, open decisions, v1 contract, and rationale.
- [User documentation](../../user/getting-started.md) — planned practical guides for package consumers, kept separate from internal planning.
- [Delivery plan](delivery-plan.md) — implementation phases, test strategy, and review gates.
- [Refined implementation specification](../specification.md) — consolidated build contract and acceptance criteria.

## What changed from the initial brief

The original brief had several policy collisions that would otherwise produce inconsistent implementation: outputs were expressed against different roots; the manifest was configurable while also described as root-only; screenshot absence was underspecified; cleanup could conflict with the promise not to touch user files; the maskable icon strategy was not actionable; and the template/type/runtime loading story was left open. The refined contract makes these behaviors explicit and testable.

Phase 0 itself was documentation-focused. Package metadata and initial Phase 1 source/tests now exist at the repository root and under `src/` and `tests/`; the image pipeline, manifest generation, CLI, and release remain future work. Do not equate Phase 1 progress with a complete package.
