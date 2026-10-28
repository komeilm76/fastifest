# Delivery plan and phase gates

This is a staged implementation plan, not authorization to skip gates. Phase 0 has been approved, Phase 1 is complete, and Phase 2 is underway. Approval applies to proceeding incrementally; it does not authorize publishing or claiming later-phase behavior.

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

## Phase 1 — foundation and contracts (complete; compatibility declaration outstanding)

Package metadata, strict TypeScript setup, public config/template types, runtime config validation, TypeScript config/template loading, path resolution/overlap checks, symlink-component rejection, errors, and logger abstractions are implemented with focused tests. The initial Phase 1 baseline passed format, typecheck, 40 tests, and build on Node 22; Node 20.20.2 and Bun 1.4.4 checks also passed. Sharp and managed-output verification are tracked in Phase 2 below. The Node engine remains undeclared until the complete runtime/OS matrix is verified.

Gate: foundation checks pass; continue to withhold runtime support claims and publish no artifacts while later runtime-sensitive functionality is unimplemented.

## Phase 2 — discovery and safe image processing (in progress)

Added `sharp@0.35.5` as a runtime dependency and a local SVG-to-PNG smoke test. The smoke test passes under Node 20.20.2, Node 22.22.3, and Bun 1.4.4 in this workspace. Implemented deterministic direct-child discovery, exact-one-logo validation, optional screenshot handling, supported-format/content checks, input byte/pixel/side limits, SVG external-reference rejection, symlink-safe bounded reads, exact screenshot metadata matching, and deterministic NFC/code-point ordering. This validates the installed runtime combination here, not other operating systems or the complete compatibility matrix; no Node engine range is declared.

Discovery tests cover ordering, optional/invalid inputs, extension mismatches, symlinks, size/dimension limits, SVG checks, metadata, and source revalidation. Logo rendering produces the four fixed PNG buffers, applies EXIF orientation and sRGB conversion, preserves transparency, fits full source bounds, enforces the maskable circular safe zone, strips metadata, and reports raster upscaling. Screenshot rendering converts inputs sequentially to deterministic PNG buffers, applies EXIF orientation/sRGB conversion, preserves alpha and explicit annotations, avoids enlargement/cropping, and caps the longest side at 4,096 pixels. Managed-output preflight now validates the four exact icon names and `screenshot-NN.png` names, checks configured output paths without creating directories or writing files, rejects overwrite-disabled collisions before mutation, preserves unrecognized files, and plans only stale regular screenshot files. A separate cleanup helper removes planned stale files only when explicitly called after manifest commit; directories are never recursively removed and cleanup failures are warnings. Windows-focused tests cover backslash traversal, drive/UNC absolute paths, nested output overlap, case-insensitive collisions, and junction/reparse-point output paths and cleanup. On this Linux host, formatting, typecheck, and build pass on Node 22; all 96 non-Windows tests pass on Node 22, Node 20, and Bun 1.4.4, while two Windows-only tests are correctly skipped. A dedicated `.github/workflows/windows-path-safety.yml` workflow runs the config, managed-output, and manifest assembly suites on Windows with Node 20 and 22, using pinned action revisions and a frozen Bun lockfile install. Hosted run `40685198956` passed the config, managed-output, manifest-assembly, and transaction suites on both Node versions. An earlier run revealed Windows fixture assumptions (short-path canonicalization and newline filenames); these were corrected before the passing run. This verifies the focused suites, not whole-package Windows support. The manifest-last transaction now consumes the planner and performs stale cleanup only after manifest commit; continue testing actual output metadata/dimensions/alpha rather than brittle pixel snapshots.

Gate: malformed inputs fail usefully; valid images yield correct dimensions and formats; overwrite and stale-file cases cannot touch unowned paths; path containment passes POSIX and Windows-focused tests.

## Phase 3 — manifest transaction and public interfaces (in progress)

`src/manifest/build.ts` assembles the validated template and generated icon/screenshot metadata into a manifest value and stable JSON string. It preserves JSON-compatible template members, emits percent-encoded public-root-relative URLs, enforces the direct-child `manifest.json` contract, omits empty screenshots, reports PWA guidance warnings, and performs no filesystem writes. It validates relative and absolute `start_url`/`scope`/`id` relationships where the deployment origin is knowable, checks scope path boundaries, and warns rather than inventing a host when an absolute URL is paired with a relative `start_url`. Without `start_url`, the browser-fallback warning remains and scope/ID relationships are not claimed to be fully checked. Focused tests cover valid and invalid URL relationships, path boundaries, URL encoding, stable formatting, no-write behavior, and invalid paths/assets.

`src/output/transaction.ts` calls preflight before filesystem mutation, creates output directories only after validation, stages asset and manifest siblings on their destination filesystems, preserves replacements with same-filesystem backups, and installs assets before the manifest. Immediately before replacing `manifest.json`, it resolves each generated `src` back to a contained planned target and verifies that target is the installed regular file from this transaction. A failed reference check triggers rollback and preserves the old manifest. Stale regular screenshots are removed only after manifest replacement succeeds; cleanup problems are warnings. Tests cover first run, overwrite, overwrite-disabled conflicts, manifest-last ordering, missing-reference failure preservation, injected manifest-rename failure with restoration, and post-commit stale-cleanup warnings. The create-only `loadOrCreateTemplate` helper loads existing templates regardless of the creation setting; for a missing enabled template it creates a starter exclusively, returns `status: "created"` as a stop signal, and provides next-step guidance without returning the starter as manifest data. It rejects symlinked template-path components, supports nested template paths, and reports `TEMPLATE_MISSING` when creation is disabled. `src/generation.ts` now exposes `generateProject({ cwd, configPath, logger })`, loading config, resolving project paths, honoring the template-created stop result before discovery, then running discovery, logo/screenshot processing, manifest assembly, and transactional output through one shared operation. It returns a discriminated `template-created` or `generated` result and aggregates warnings from each stage. Integration tests cover first-run early stop without creating the public tree, complete generation and manifest references, warning aggregation, custom config/template paths, and preservation of an existing manifest when discovery fails. Local formatting, typecheck, build, and 112 tests pass on Node 22 (two Windows-only tests skip locally). Hosted run `40685198956` passed the earlier transaction suites; URL/reference validation passed as run `40686368236`, and template scaffolding passed as run `40687388386`, both on Node 20 and 22. The Windows workflow now includes the integration suite; run `40687927287` passed on Node 20 and 22.

`src/cli.ts` implements the `fastifest` binary and delegates to `generateProject`. It handles help, version, config-path forms, usage diagnostics, and process exit codes without swallowing generation errors. Tests exercise first-run scaffolding, successful explicit-config generation, malformed arguments, version/help, and concise failure diagnostics. `package.json` maps the binary to `dist/cli.js`; the built script retains its Node shebang. `generateProject` repeat-run tests now verify that changed templates and logos replace managed outputs, stale screenshots are removed while unrecognized files remain, and `overwrite: false` preserves the last successful manifest and assets. Discovery failure likewise preserves pre-existing output. These tests exposed Jiti's default cross-invocation module cache returning a stale template on a later API call; config and template loaders now disable that cache, with same-process edit/reload tests. Local format check, typecheck, all 125 tests (2 Windows-only skips), build, direct built CLI help/version, and `npm pack --dry-run` passed. The Windows focused workflow includes the expanded integration suites; run `40698213987` passed on Node 20 and 22.

Packed-install verification and final consumer documentation remain. Next, verify the CLI executable and API from a temporary packed installation, then update user docs from that tested package behavior.

Gate: every generated manifest reference resolves to a contained installed regular output before manifest commit; caught failures preserve the previous manifest; CLI and API share the same core.

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
