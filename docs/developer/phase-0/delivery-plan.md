# Delivery plan and phase gates

This is a staged implementation plan, not authorization to skip gates. Phase 0 has been approved, and Phase 1 is underway. Approval applies to proceeding incrementally; it does not authorize publishing or claiming later-phase behavior.

## Phase 0 — specification, design, user documentation (approved)

**Goal:** remove ambiguity and produce a useful user-facing design draft before code.

Deliverables:

- Refined, internally consistent implementation specification.
- Decision log for API/configuration, file discovery, image processing, manifest ownership, path safety, runtime, and release policy.
- Separate consumer-facing guides under `docs/user/`, explicitly labeled as planned until verified.
- Phased implementation and verification plan.

Exit criteria:

- User reviews product scope and proposed behaviors.
- Open decisions in `decisions.md` are confirmed or assigned.
- No claim implies package functionality exists.

## Phase 1 — foundation and contracts (in progress)

Package metadata, strict TypeScript setup, public config/template types, runtime config validation, TypeScript config/template loading, path resolution/overlap checks, symlink-component rejection, errors, and logger abstractions are implemented with focused tests. The Phase 1 baseline passed format, typecheck, 40 tests, and build on Node 22; Node 20.20.2 and Bun 1.4.4 checks also passed. Sharp runtime verification is tracked in Phase 2 below. The Node engine remains undeclared until the complete runtime/OS matrix is verified.

Gate: current foundation checks pass; continue to withhold runtime support claims and publish no artifacts while later runtime-sensitive functionality is unimplemented.

## Phase 2 — discovery and safe image processing (in progress)

Added `sharp@0.35.5` as a runtime dependency and a local SVG-to-PNG smoke test. The smoke test passes under Node 20.20.2, Node 22.22.3, and Bun 1.4.4 in this workspace. This verifies the installed runtime combination here, not other operating systems or the complete compatibility matrix; no Node engine range is declared. The discovery and generation pipeline has not started.

Next, implement deterministic non-recursive discovery, symlink policy, file/pixel limits, strict one-logo handling, screenshot warnings, icon/screenshot generation, naming, metadata stripping, and managed-output ownership. Add small deterministic fixtures and test actual metadata/dimensions/alpha rather than brittle pixel snapshots.

Gate: malformed inputs fail usefully; valid images yield correct dimensions and formats; overwrite and stale-file cases cannot touch unowned paths; path containment passes POSIX and Windows-focused tests.

## Phase 3 — manifest transaction and public interfaces

Implement template creation/loading and validation, generated manifest collections, `manifest.json` at the configured public-root top level, public-root URL mapping, output existence validation, stable JSON formatting, manifest-last atomic replacement, CLI/API behavior, help/version, and exit codes. Add temporary-project integration tests for first run, repeated run, missing template, overwrite modes, and failure preservation.

Gate: every manifest URL maps to a generated file; failures do not corrupt the previous manifest; CLI and API share the same core.

## Phase 4 — user documentation and CI

Keep consumer docs in root `README.md` and `docs/user/**`; keep contributor/release/phase docs in `docs/developer/**` and maintainer files such as `CONTRIBUTING.md`. Verify every user command and example against a local package run. Add public API JSDoc, a working example, changelog, contribution and security guidance, license, issue templates as appropriate, and GitHub Actions. CI should install pinned Bun, use the committed lockfile, format-check, typecheck, test, build, and inspect package contents. Test supported runtime/OS combinations; do not advertise untested combinations.

When package metadata is added, allowlist only runtime output and intended user-facing package files (including root `README.md` and `docs/user/**`); exclude `docs/developer/**` and internal prompts. Verify the actual tarball file list with `npm pack --dry-run`.

Gate: run every check locally; inspect package contents. Verify docs and examples against an actual local package run. Do not publish or create a public release.

## Phase 5 — release readiness (only when authorized)

Choose and configure one reviewable versioning approach, confirm npm package identity and ownership, verify Trusted Publishing/OIDC and protected environments, review workflow permissions and action pinning, validate changelog/tag policy, and have a maintainer review release readiness. This phase documents and prepares; actual publish or public release still requires explicit owner authorization.

## Cross-cutting quality strategy

- Tests are network-independent and use temporary project roots.
- Test both successful outputs and negative/security boundaries.
- Keep fixture images small; assert metadata, dimensions, file existence, and manifest URLs.
- Avoid flaky elapsed-time or byte-identical native image assertions unless deterministic encoding is demonstrated.
- Test JSON stability and repeated-run cleanup without deleting arbitrary fixture files.
- Review final diff for unrelated edits, claims unsupported by test evidence, unsafe filesystem operations, and generated artifacts.
- Report every command and its observed result; state clearly when a check could not run.

## Phase 1 checkpoint and remaining work

- [x] Add ESM package metadata, Bun lockfile, strict TypeScript/build configuration, formatter, license, and npm `files` allowlist.
- [x] Add public configuration/template types, runtime config validation, TypeScript config/template loading, error/logger abstractions, path resolution, overlap checks, and symlink-component rejection.
- [x] Add focused tests for defaults, malformed config/template values, config loading, path relationships, symlinked output paths, and logger thresholds.
- [x] Pass format check, typecheck, tests, and build on Node 22; repeat typecheck, tests, and build on Node 20; run Vitest under Bun; smoke-test the built package entry on Node 20.
- [ ] Keep the Node engine range undeclared until the complete supported runtime/OS matrix, including `sharp`, has been proven.
- [ ] Complete discovery/image generation, transactional manifest output, public API/CLI, end-to-end tests, and verified user docs in later phases.
- [ ] Add CI, package-content verification, contributor/security/release materials, and final safety/documentation review.
- [ ] Do not publish or create a public release without explicit authorization.
