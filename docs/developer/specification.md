# Fastifest — refined implementation specification

**Specification status:** Approved implementation contract; Phases 2–3 are in progress. This document defines intended product behavior, not evidence that all described capabilities exist. The image pipeline, in-memory manifest assembly, manifest URL relationship validation, manifest-last output transaction, create-only template helper, shared `generateProject` operation, and a CLI backed by that operation are implemented in focused modules; complete consumer documentation and release remain incomplete.

Related Phase 0 documents:

- [Overview and review gate](phase-0/README.md)
- [Requirements and design decisions](phase-0/decisions.md)
- [Consumer documentation](../user/getting-started.md)
- [Delivery plan](phase-0/delivery-plan.md)

## 1. Product mission

Build `fastifest`, a small TypeScript developer tool that discovers a project's logo and screenshots, generates standardized image assets with `sharp`, and writes a Web App Manifest. It should be safe by default, deterministic, easy to diagnose, and usable from both a CLI and a small typed API backed by the same core.

The first release is local tooling. It is not a GUI, hosted service, bundler/framework plugin, image editor, AI service, or browser-conformance guarantee. Prefer reliable, testable behavior over speculative options.

## 2. Execution protocol and phase gate

1. **Phase 0 (approved):** review/refine requirements, resolve product decisions, document planned user experience, and agree on acceptance criteria. This gate has been passed for incremental implementation.
2. **Phase 1 onward (underway):** build incrementally, test alongside features, and keep documentation aligned with verified behavior. Approval to proceed does not imply completion of later phases.
3. Do not publish, create a public release, or perform another irreversible external action without explicit authorization.
4. Never claim checks, package-name availability, compatibility, release, or publication succeeded unless actually verified.

Approved implementation sequence: foundation/config and paths; discovery/image pipeline; manifest/API/CLI; verified user docs and CI; release readiness. See the delivery plan for gates and test detail.

## 3. Package, language, and runtime standards

- Package name `fastifest`; description clearly states it generates Web App Manifest files and standardized icons/screenshots.
- TypeScript, strict compiler options, focused modules, accurate public JSDoc, and precise types. Avoid `any`; use and immediately narrow `unknown` at untrusted boundaries.
- Bun for development, scripts, dependency installation, tests, and builds where practical. Do not impose Bun on npm consumers unless explicitly approved and documented.
- Declared npm consumer floor: Node.js `>=20.10.0`, verified by packed-install generation smoke tests on Ubuntu, Windows, and macOS. Full candidate checks pass on Node 20, 22, and 24 on those runner OSes. Node 20.9.0 is not viable with the installed Sharp entrypoint because it cannot parse the JSON import-attribute syntax used there. This evidence is limited to the tested architectures/libcs; do not imply broader compatibility. Bun is a development/runtime candidate only on Ubuntu; do not advertise Bun consumer support on Windows/macOS without passing evidence.
- `sharp` for image processing; Vitest for tests; Prettier or an equivalent formatter. Keep runtime dependencies minimal and document native `sharp` behavior.
- Publish only compiled runtime files, declarations, CLI entry if present, and required assets. Configure `files`, `exports`, `types`, `bin`, and `engines` accurately. Include MIT license unless repository policy/owner says otherwise.
- Never commit credentials, tokens, private/generated user data, or local environment files.

## 4. Configuration and root resolution

The full proposed shape, defaults, and unresolved choices are recorded in [design decisions](phase-0/decisions.md). Key contract:

- Load a TypeScript default export from `fastifest.config.ts`; allow `--config <path>`.
- Resolve source and template paths from the consuming project's root (`cwd`), never the installed package or source module location. Resolve `paths.public` from the project root.
- Resolve all inputs and outputs to normalized absolute filesystem paths before validation or I/O.
- Proposed public root default: `./public`; manifest default: `./manifest.json`, relative to the public root and strictly a direct child of that folder in v1.
- Proposed output subpaths (`icons`, `screenshots`) also resolve relative to the public root and must remain within it.
- Proposed source directories: `./assets/logos` and optional `./assets/screenshots`; confirm the logo default before implementation.
- Validate malformed and unknown config values with actionable field-specific errors. Logging levels: `error`, `warn`, `info`, `debug`.
- TypeScript config/template files execute code. Use a declared, dependable loader tested under every supported runtime, evaluate each file at most once per run, and document that only trusted files should be loaded.
- `template.enabled` controls create-if-missing scaffolding only; it does not disable loading. If disabled and the template file is missing, fail clearly; if present, load and validate it normally. Template creation is create-only. Never silently replace a pre-existing template.

## 5. Discovery contract

- Non-recursive direct-child discovery; case-insensitive suffix matching.
- Logos: `.png`, `.jpg`, `.jpeg`, `.svg`; screenshots: `.png`, `.jpg`, `.jpeg`.
- Sort deterministically, independent of filesystem enumeration order.
- Extensions are not proof of content; inspect metadata/decode every supported-extension file. Treat corrupt input and extension/content-type mismatch as fatal errors with a useful path-level diagnostic, rather than silently skipping them.
- Exactly one usable logo is required. Zero or multiple logos are fatal; do not select one arbitrarily.
- A missing/empty screenshot directory is optional and emits a warning; generate no misleading placeholder entries.
- Unsupported entries may be ignored with a concise warning. Avoid unbounded logs for directories with many files.
- Do not follow symlinks in input discovery. Reject paths that escape configured roots or alias output roots.
- Enforce the proposed Phase 0 limits: 20 MiB per raster source, 2 MiB per SVG, 40 megapixels and 12,000 pixels per side for decoded raster images, and a 4,096-pixel screenshot maximum side. Process inputs sequentially; adjust these limits only with evidence and corresponding tests.

## 6. Image generation

Use `sharp`. Apply EXIF orientation before geometry, normalize output color to sRGB, and strip source metadata. Preserve logo aspect ratio and complete artwork; never stretch or crop. Proposed fixed PNG outputs:

| Name                    |      Size | Manifest purpose |
| ----------------------- | --------: | ---------------- |
| `icon-192.png`          | 192 × 192 | `any`            |
| `icon-512.png`          | 512 × 512 | `any`            |
| `icon-maskable-192.png` | 192 × 192 | `maskable`       |
| `icon-maskable-512.png` | 512 × 512 | `maskable`       |

Fit logo on a square transparent canvas. For maskable variants, keep all visible logo content inside the central circular safe zone, whose diameter is 80% of the canvas; 10% padding along the straight edges alone is not sufficient because corner content may be clipped. Test wide, tall, square, and transparent artwork. Warn if source resolution is below a target; explain upscaling cannot restore detail. Preserve transparency and strip metadata by default.

SVG input is limited to 2 MiB; reject remote/external file references, bound parser/rasterization work, and rasterize only at the fixed icon output sizes rather than trusting declared SVG dimensions for bitmap allocation. Do not execute shell commands. Do not promise complete protection from malicious SVG/image input.

Screenshots convert to PNG with deterministic names `screenshot-01.png`, `screenshot-02.png`, etc. Apply EXIF orientation first, preserve aspect ratio, never crop or upscale, and proportionally reduce over the proposed 4,096-pixel maximum side. Manifest metadata must reflect the final oriented output dimensions; do not guess `form_factor`. This proposed limit is listed for Phase 0 review.

### Ownership, overwrite, cleanup

Only exact Fastifest filenames in the configured dedicated output directories are managed. Treat those names as reserved and explain that users should not store hand-managed assets under them. Never recursively delete directories. A successful rerun may remove stale files matching the reserved screenshot naming pattern, but only after the new manifest is committed; leave unrecognized files untouched. With overwrite disabled, preflight every reserved output that would be written, replaced, or removed (including stale screenshots), and fail without changing files if any exist. Even with overwrite enabled, do not overwrite paths outside the reserved names. Stage outputs on the same filesystem, replace assets, then replace the manifest last. On a caught commit error, attempt rollback from backups; clean temporary files. Explain that multi-file replacement cannot be fully atomic across process crashes or power loss.

## 7. Manifest template and generation

- `manifest.template.ts` exports a default object of developer-managed manifest properties.
- Fastifest exclusively generates `icons` and `screenshots`; reject these keys at runtime if template provides them. Types should make misuse difficult, but runtime validation is authoritative.
- Preserve developer-provided JSON-compatible manifest fields. Validate known fields and nested values against an explicit, documented Web App Manifest schema/spec snapshot. Unknown JSON-compatible extension members may be preserved but cannot be semantically validated; do not claim browser conformance.
- Require at least one of `name` or `short_name` as a Fastifest usability rule; validate known manifest field types. Do not misstate product recommendations (for example, a recommended short-name length) as requirements of the Web Manifest standard.
- Validate URL relationships that can be determined independently of the final site origin: when supplied, `start_url` must resolve same-origin with the manifest URL; if `scope` is also supplied, it must resolve same-origin and contain `start_url`; a supplied `id` must be same-origin with `start_url` but need not be within `scope`. Respect relative URL resolution; do not synthesize an app `id`. When relative references are mixed with an absolute URL but the site origin is unknown, do not invent an origin—validate origin-independent path containment and warn when a same-origin relationship cannot be fully determined. If `start_url` is absent, warn that the browser may fall back to the linking page and scope/ID relationships cannot be fully checked.
- Warn (do not fail standards validation) if `start_url` or both `display` and `display_override` are absent, or if `prefer_related_applications` is `true`; explain that these can affect Chromium install promotion and that installability is browser-specific.
- Generated icon entries include `src`, `sizes`, `type: 'image/png'`, and the correct `purpose`. Screenshot entries include `src`, actual `sizes`, and type. Optional `screenshots.metadata` keyed by exact source basename may provide `label` and `formFactor` (serialized as `form_factor`); reject keys for undiscovered files and never infer these values. When no screenshots are discovered, warn and omit the `screenshots` member entirely.
- Browser URL resolution is relative to the **deployed manifest URL**, not a filesystem root. Generate relative `src` URL paths with forward slashes and no filesystem paths (for the default mapping, `icons/icon-192.png`). The manifest and output folders live inside the configured public root, so the default mapping assumes that tree is served at the same URL base (for example, `/manifest.json` and `/icons/icon-192.png`). Validate the filesystem references are contained in the public root, and document the deployment assumption and its limits.
- Do not merge stale fields from an existing manifest. Output is based on template plus freshly generated collections.
- Serialize UTF-8 JSON with stable two-space indentation and trailing newline. Before replacing the final manifest, verify each generated URL reference resolves to a contained, installed regular output file and that it is the file installed by this transaction. Use a temporary sibling file and atomic rename where supported, with cleanup on failure.
- With template creation enabled, if the template is missing, create the starter with an exclusive create-only file operation, provide next-step guidance, and return a distinct first-run stop result without loading the starter as manifest data. If template creation is disabled and no template exists, fail clearly. If the file already exists, load it normally regardless of the creation setting and never overwrite it.

## 8. Path safety

- Resolve and normalize all paths against project root/public root according to the documented config semantics.
- Detect traversal, input symlinks, symlink/reparse-point output components or reserved targets, output escape, input/output overlap, output-to-output conflicts, manifest inside generated folders, and invalid manifest location. Never write through a symlink; re-check canonical parents before commit where practical and document residual TOCTOU limits.
- Output directories must remain inside the configured public root; do not assume every framework uses a folder named `public`.
- Use URL paths with `/` regardless of filesystem OS. Test POSIX and Windows semantics.
- Never recursively remove user directories. Include focused negative tests for `..`, conflicting paths, symlinks, and reserved-name collisions.

## 9. CLI, API, logs

The package binary is `fastifest`, mapped to the built `dist/cli.js`. It supports `--help`/`-h`, `--version`/`-v`, and `--config <path>`/`-c <path>` (including `--config=<path>`). Usage errors return exit code 2; generation errors return 1; successful generation or first-run template scaffolding returns 0. The CLI calls the shared `generateProject({ cwd, configPath, logger })` operation rather than reimplementing pipeline steps. A `template-created` result is a successful first-run stop state and is not treated as completed manifest generation.

Logs should be stable and concise with levels `error`, `warn`, `info`, `debug`; include actionable file/key context without secrets or full config dumps. Distinguish fatal errors from per-file warnings. Summarize inputs, outputs, warnings, and elapsed time when practical. Avoid cosmetic dependencies unless justified.

## 10. Testing and quality gates

Use Vitest; tests must not depend on network access. Use temporary fixture projects and small local test images. Cover at least:

- Defaults, config validation and loading from project root/explicit config path.
- Extensions, case-insensitive discovery, deterministic ordering (including normalized/case-colliding basenames), missing/empty directories, multiple logos.
- Corrupt/mismatched images, SVG safety limits, EXIF orientation, sRGB output, dimensions, alpha, maskable padding, warnings for upscaling.
- Screenshot PNG conversion, dimensions, no-upscale, naming/order, optional exact-basename metadata (`label`/`formFactor`), invalid metadata keys, and omission of the manifest member when no screenshots are present.
- Manifest field/type validation, `start_url`/`scope`/`id` URL relationships including unresolved-origin warnings and path boundaries, PWA-guidance warnings, generated icon/screenshot metadata, optional screenshot labels/form factors, omission of `screenshots` when empty, stable JSON, and deployed-URL/public-root mapping.
- Traversal, input/output symlinks and Windows reparse points, overlapping/conflicting paths, POSIX/Windows semantics.
- Existing template preservation, first-run behavior, overwrite modes, stale output cleanup.
- CLI exit codes, API behavior, integration runs, repeat-run stability, and old-manifest preservation on failure.
- Ensure every manifest reference exists within public root.

Avoid brittle pixel-perfect and timing assertions. Test image metadata/dimensions and meaningful output behavior. Add lightweight performance/resource-limit verification rather than unsupported benchmark claims.

Before completion run and report formatting, typecheck, unit/integration tests, build, and package-content inspection. Fix failures; say exactly why any check could not run.

## 11. CI, release, and publishing

- Add maintainable GitHub Actions workflows for pull requests and pushes to the default branch: install pinned Bun, reproducible lockfile install, formatting, typecheck, tests, build, package-content check.
- Test the supported runtime/OS combinations; at minimum Linux and Windows if cross-platform support is claimed. Keep matrix proportional to project size.
- Use least-privilege permissions, reviewed/pinned actions per repository policy, and never expose publish credentials to pull requests.
- Start with a documented, reviewable manual SemVer/tag process. Defer release-bot selection until release readiness; if maintainers choose automation, adopt one auditable tool only. Keep changelog/version/tag format consistent and avoid duplicate releases/tags.
- Prefer npm Trusted Publishing with GitHub Actions OIDC. Document repository/npm setup and protect publishing environment. Never hard-code a token.
- Do not execute a real publish or public release without explicit authorization.

## 12. Documentation requirements

Before release, provide accurate consumer docs in the root `README.md` and `docs/user/**`: value proposition, install/quick start, complete configuration reference, tested CLI/API, generated tree and manifest example, supported formats/runtime, behavior and limits, troubleshooting, and links to working examples. Keep contributor, security-maintainer, release, and phase-planning material separate from the npm-facing docs. Add JSDoc for public API and important behavior; issue templates as appropriate. Avoid keyword stuffing and unsupported claims. Verify the package name before publishing but do not claim availability unless checked. Before publishing, remove pre-release banners and planning-only statements from consumer docs only after every documented command, option, default, and example has been verified.

## 13. Acceptance criteria after implementation

- [ ] Public API and/or CLI documented and backed by one core implementation.
- [ ] Config loads from consumer root and explicit config path; runtime and loader support proven.
- [ ] Deterministic discovery supports stated formats without per-file config.
- [ ] Exactly-one-logo and optional-screenshot behavior is implemented and tested.
- [ ] Icons and screenshots have documented deterministic PNG sizes, naming, and aspect-ratio behavior.
- [ ] Template is create-only; template-defined generated collections are rejected.
- [ ] Optional screenshot labels and explicitly supplied form factors are validated and serialized; no screenshot metadata is guessed.
- [ ] Manifest output is valid JSON with known members validated against the documented schema snapshot, stable, directly inside the public root by policy, uses correct deployed-relative URLs, and references existing assets contained in the public root.
- [ ] Config/path validation and overwrite/cleanup ownership are tested.
- [ ] Errors and warnings are actionable; failures preserve prior manifest and clean temporary files.
- [ ] Unit/integration tests, formatting, typecheck, build, and package checks pass.
- [ ] CI quality gates and safe release/publish documentation are present.
- [ ] README, JSDoc, license, changelog, security and contribution documents are accurate.
- [ ] No npm publish, public release, or other irreversible external action occurred without authorization.

## 14. Final implementation report format

After implementation is authorized and completed, report: (1) implemented capabilities/files; (2) key design decisions; (3) each validation command and observed result; (4) workflow triggers and required repository settings; (5) verified remaining limitations; (6) owner manual steps; and (7) release status, explicitly “No; not authorized” unless an authorized release actually occurred.
