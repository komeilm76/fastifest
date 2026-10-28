# Fastifest — Implementation Specification for an Autonomous Coding Agent

## 1. Mission

Build and publish-ready the npm package **`fastifest`**, a developer-focused TypeScript tool that discovers source logos and screenshots, generates standardized image assets with `sharp`, and creates or updates a standards-compliant `manifest.json` at the project root.

Treat this document as the implementation contract. Make sensible low-cost decisions where details are not specified, document those decisions, and prioritize a small, reliable first release over speculative features.

**Do not stop after writing a plan.** Inspect the repository and its existing conventions, implement the project, add tests and CI workflows, run the available checks, fix failures, and report exactly what was completed and what remains.

If working in an existing repository, preserve useful conventions and user changes. Do not overwrite unrelated files, discard user work, publish a package, create a public release, or perform another irreversible external action without explicit authorization.

## 2. Product Scope

### Required behavior

1. Load project settings from `fastifest.config.ts`.
2. Resolve configured paths relative to the consuming project's root—not relative to Fastifest's installed package or the current source file.
3. Discover supported input images automatically from configured directories; input filenames and extensions must not need to be specified individually.
4. Generate deterministic, standardized logo/icon files and screenshot files using `sharp`.
5. Generate a valid Web App Manifest JSON file at the consuming project's root.
6. Support an optional `manifest.template.ts` generation setting. When enabled, create the template if it does not exist. Never silently overwrite an existing template.
7. Let the template contain the normal supported Web App Manifest properties, but not developer-managed `icons` or `screenshots` entries. Fastifest owns these generated collections.
8. Validate configuration, paths, source files, template data, generated assets, and final manifest. Report actionable errors and warnings.
9. Include unit and integration tests, professional documentation, package metadata, and GitHub Actions workflows for quality gates, versioning, tags, releases, and npm publishing.
10. Use Bun, TypeScript, `sharp`, Vitest, and JSDoc.

### Out of scope for the first release

Do not build a GUI, hosted service, AI image generation, distributed processing, a plugin ecosystem, a complex caching layer, or a large framework of browser-specific options. Keep the public API small and extensible.

## 3. Repository and Package Standards

- Package name: `fastifest`.
- Description should clearly say that Fastifest generates Web App Manifest files and standardized icons/screenshots.
- Use TypeScript with strict compiler settings.
- Use Bun for development scripts, dependency installation, tests, and builds where practical.
- Use `sharp` for image processing.
- Use Vitest for unit and integration tests.
- Document public APIs with useful JSDoc, including parameters, return values, errors, and examples where appropriate.
- Use Prettier or an equivalent consistent formatter.
- Avoid `any`. Use precise types and runtime validation at configuration and file boundaries.
- Do not use `unknown` as a way to avoid defining meaningful types; use it only at genuinely untrusted boundaries and narrow it immediately.
- Prefer small modules with one clear responsibility.
- Keep runtime dependencies minimal.
- Declare the supported Node.js/Bun environment accurately. Do not claim compatibility that has not been tested. Since npm consumers may use Node.js, ensure the published package can be installed and run by the explicitly documented supported runtime(s); do not make Bun a runtime requirement for consumers unless that is an intentional, documented decision.
- Verify `sharp` installation and native-binary behavior on supported platforms.
- Publish only compiled runtime files and required package assets. Configure `files`, `exports`, `types`, and `bin` correctly if a CLI is provided.
- Include a license file; use MIT unless repository policy or the owner specifies otherwise.
- Never commit credentials, tokens, generated private data, or local environment files.

## 4. Configuration Contract

Create a documented, typed `fastifest.config.ts` with an API similar to the following. Treat this as a proposed starting shape; refine it if necessary for a coherent, ergonomic API, and document any deviations.

```ts
import type { FastifestConfig } from 'fastifest';

const config = {
  paths: {
    logos: './assets/logos',
    screenshots: './assets/screenshots',
    manifest: './manifest.json',
    public: './public',
    output: {
      logos: './public/icons',
      screenshots: './public/screenshots',
    },
  },
  template: {
    enabled: true,
    path: './manifest.template.ts',
  },
  images: {
    overwrite: true,
  },
  logging: {
    level: 'info',
  },
} satisfies FastifestConfig;

export default config;
```

### Configuration requirements

- Provide documented defaults where safe, such as `public: './public'`, `manifest: './manifest.json'`, logo output `./public/icons`, and screenshot output `./public/screenshots`.
- Input directories should be configurable.
- Do not require the developer to specify each input filename.
- `template.enabled` controls whether Fastifest creates a starter `manifest.template.ts`; the default should be clearly documented.
- If the template already exists, never replace it automatically.
- Define and validate the supported logging levels.
- Define clear overwrite behavior. Never overwrite arbitrary files outside Fastifest's managed output paths. If `overwrite: false`, existing managed output files should be handled predictably and reported.
- Validate unknown or malformed config values at runtime with useful error messages.
- Do not execute arbitrary configuration code more than necessary. Document that a TypeScript config file is executable code.
- Make configuration loading work reliably from the consuming project's root, with an explicit `--config` option if a CLI is implemented.
- Prefer a simple API and a single obvious default config filename.

## 5. Input Discovery

### Logo inputs

Support these extensions, case-insensitively:

- `.png`
- `.jpg`
- `.jpeg`
- `.svg`

### Screenshot inputs

Support these extensions, case-insensitively:

- `.png`
- `.jpg`
- `.jpeg`

Requirements:

- Discover files from the configured directories without hard-coded input filenames.
- Use deterministic ordering so the same inputs produce the same output ordering across runs.
- Ignore unsupported files with a clear warning or documented quiet behavior.
- Decide and document whether discovery is non-recursive by default; prefer non-recursive discovery for the first release to keep behavior predictable.
- Fail clearly if a required input directory is missing or contains no usable logo.
- A missing/empty screenshot directory should produce a documented warning or configurable error, rather than silently creating misleading manifest data.
- Inspect actual image metadata and validate that each file is readable.
- Do not trust extensions alone; malformed or mismatched files must be handled safely.
- Avoid following symlinks outside configured input roots unless there is an explicit, safe, documented policy.
- If multiple logo files are found, define deterministic selection behavior. Prefer requiring one primary logo in v1, or define a simple explicit priority rule and warn when selection is ambiguous. Do not silently select an arbitrary logo.
- If multiple logos are intentionally supported as alternate source variants, document how each maps to generated outputs.

## 6. Image Generation

Use `sharp` to produce the managed assets. Define a documented, stable naming and sizing contract and cover it with tests.

### Suggested initial icon set

At minimum, consider:

- `icon-192.png` — 192×192
- `icon-512.png` — 512×512
- `icon-maskable-192.png` — 192×192
- `icon-maskable-512.png` — 512×512

These sizes are proposed defaults, not a claim that every app requires all of them. Confirm the Web App Manifest requirements and implement appropriate metadata for each output. For maskable icons, use a documented safe-area/padding strategy; do not merely duplicate a regular icon and label it maskable without considering the maskable purpose.

### Logo processing

- Support PNG/JPG/JPEG/SVG source logos.
- Produce valid, deterministic PNG outputs.
- Preserve aspect ratio; do not stretch logos.
- Define how transparent backgrounds are handled.
- For square icons, document whether the source is fitted onto a square canvas with padding or cropped. Prefer fitting with padding to avoid cutting off logos.
- For maskable icons, provide suitable safe padding and document the approach.
- Warn when the source resolution is too small for an output target; upscaling does not restore lost detail.
- Validate SVG input and process it safely. Avoid unsafe or unbounded SVG processing. Set sensible input-size and processing limits.
- Handle corrupt files and report the offending path without exposing secrets or dumping excessive internals.

### Screenshot processing

- Convert supported screenshots to the documented output format, preferably PNG for a predictable first release.
- Preserve aspect ratio and avoid cropping or stretching by default.
- Avoid unnecessary upscaling. If resizing is needed, define a predictable maximum dimension or a documented configuration option.
- Use deterministic output names such as `screenshot-01.png`, `screenshot-02.png`, etc.
- Record each output's actual width and height in the final manifest.
- Do not invent or alter screenshot content.
- Keep image metadata behavior intentional; strip unnecessary metadata where appropriate and document it.
- Ensure repeated runs do not accumulate stale managed output files indefinitely. Clean only files that Fastifest can confidently identify as its own managed outputs, and never recursively delete arbitrary folders.

## 7. `manifest.template.ts` and Manifest Generation

### Template behavior

When template generation is enabled:

- Create `manifest.template.ts` from a packaged starter template if it does not exist.
- Never overwrite an existing template without a separate, explicit user action.
- The template should expose normal Web App Manifest fields, including commonly used fields such as `id`, `name`, `short_name`, `description`, `start_url`, `scope`, `display`, `background_color`, `theme_color`, `lang`, `dir`, `categories`, `orientation`, `prefer_related_applications`, `related_applications`, `shortcuts`, `protocol_handlers`, and other valid properties supported by the selected manifest specification.
- Do not let the template control generated `icons` and `screenshots`; those collections are generated from source assets.
- Provide a useful typed `ManifestTemplate` type that omits or prevents developer-defined generated collections. Document any limitations imposed by TypeScript's structural typing.

### Loading and compiling the template

- Choose a dependable, documented way to load TypeScript templates in supported runtimes. Avoid relying on undocumented loader behavior.
- Do not evaluate the same template repeatedly within a single run.
- Provide actionable errors for syntax errors, import failures, invalid exports, and invalid property values.
- If using a TypeScript execution mechanism, declare the relevant dependency and test it under every supported runtime. Alternatively, define a clear build/loader strategy.
- Document that template files are executable code and should only be loaded from trusted projects.

### Manifest generation

- Generate `manifest.json` in the project root by default.
- Preserve supported developer-defined properties from the template.
- Generate `icons` and `screenshots` from the assets actually written.
- Use paths relative to the web app's public root, with URL paths using `/` separators regardless of the host OS. Do not put filesystem absolute paths in the manifest.
- Validate that all referenced output assets exist inside the configured public root.
- Populate correct icon metadata, including `src`, `sizes`, and `type`; add `purpose: "maskable"` for maskable icons where appropriate.
- Populate screenshot metadata, including `src`, `sizes`, `type`, and suitable `form_factor` only when it can be determined reliably. Do not guess device form factors.
- Ensure the output is valid JSON with stable, readable formatting.
- Validate required fields and types against the selected Web App Manifest specification. Do not reject valid optional fields simply because they are not in the initial example.
- Fail before replacing the final manifest if generation or validation fails.
- Write to a temporary file and replace the target atomically where the platform permits.
- If an existing manifest is present, make the behavior explicit: the generated manifest is derived from the configured template and generated assets. Do not silently merge stale fields from an old manifest unless that behavior is deliberately designed, documented, and tested.
- Avoid producing a manifest that references missing or stale outputs.

## 8. Public Root and Path Safety

The developer knows the public folder must contain web-served assets and that the manifest should be at the project root by default.

Implement strong path validation:

- Normalize paths against the consuming project root.
- Verify that the manifest path is at the project root according to the documented policy. If only `./manifest.json` is allowed in v1, enforce that explicitly and explain the error.
- Verify that generated output directories resolve inside the configured public root.
- Account for `..` path traversal and, where relevant, symlinks.
- Detect conflicting paths, such as output folders overlapping input folders or the manifest being placed inside a generated asset directory.
- Never delete or overwrite arbitrary user files outside managed outputs.
- Do not assume a directory named `public` is used by every framework. Allow the developer to configure the public root.
- Emit clear errors with the invalid path and the expected rule.
- Test Windows and POSIX path semantics in CI or focused unit tests. Manifest URLs must always use forward slashes.

## 9. CLI and Public API

Provide a simple developer experience. A CLI is recommended, with commands such as:

```bash
bunx fastifest
bunx fastifest --config ./fastifest.config.ts
```

Choose a small command surface for v1. At minimum, implement one reliable build/generate command and helpful `--help` output. Consider `--version` and a `--check` or dry-run mode only if they can be implemented cleanly without expanding scope excessively.

Also expose a small typed programmatic API if useful, for example:

```ts
import { generateManifest } from 'fastifest';

await generateManifest({ cwd: process.cwd() });
```

Treat these signatures as illustrative, not mandatory. Finalize and document the public API. Keep CLI and programmatic behavior backed by the same core implementation rather than maintaining two separate implementations.

Exit codes must be meaningful: success is zero; configuration, validation, or generation failures must return non-zero. Avoid swallowing errors.

## 10. Logging and Diagnostics

- Provide concise, consistent logs with `info`, `warn`, `error`, and optionally `debug` levels.
- Include enough context to fix a problem, especially relevant file paths and expected formats.
- Do not log secrets or dump entire environment/config objects.
- Distinguish fatal errors from per-file warnings.
- Report a final summary: number of input files found, outputs generated, warnings, and elapsed time if straightforward.
- Avoid excessive dependencies for colored output or terminal formatting.
- Make output stable enough to be understood in CI logs.

## 11. Testing Strategy

Use Vitest and include both unit and integration tests.

### Unit tests

Cover at least:

- Config defaults and validation.
- Config resolution from project root and explicit config path.
- Supported extensions and case-insensitive discovery.
- Deterministic file ordering.
- Missing directories and empty input handling.
- Invalid/corrupt image handling.
- SVG validation and error handling.
- Icon dimensions, PNG output, aspect ratio, transparency, and maskable padding.
- Screenshot output dimensions, format, naming, and ordering.
- Manifest fields and generated `icons`/`screenshots` metadata.
- Public-root containment, traversal attempts, and conflicting paths.
- Existing template preservation.
- Overwrite behavior.
- Stable output and repeat-run behavior.
- CLI success/failure exit codes.

### Integration tests

Use temporary fixture projects with real, small test images. Verify end-to-end that:

1. A config is loaded.
2. Inputs are discovered.
3. Icons and screenshots are generated.
4. The manifest is written to the project root.
5. Every manifest asset URL maps to an existing file inside public root.
6. Running twice produces stable results and does not accumulate stale files.
7. Invalid configuration or invalid images fail safely without leaving a corrupted manifest.
8. A pre-existing template is not overwritten.

Tests must not depend on network access. Keep fixtures small and avoid unnecessary platform-sensitive pixel comparisons. Test meaningful image metadata and dimensions instead.

## 12. GitHub Actions and Release Automation

Create clear, maintainable workflows under `.github/workflows/`.

### CI / quality gates

Run on pull requests and pushes to the default branch:

- Install the pinned Bun version.
- Install dependencies reproducibly using the committed lockfile.
- Formatting check.
- TypeScript typecheck.
- Unit tests.
- Integration tests.
- Build.
- Package-content validation (for example, inspect `npm pack --dry-run`).
- Test on a sensible supported OS/runtime matrix. At minimum, validate Linux and Windows if cross-platform support is claimed. Do not create a huge matrix that makes early development expensive.

Use least-privilege workflow permissions. Pin third-party actions to reviewed versions or immutable SHAs according to repository policy. Do not expose publish credentials to pull-request workflows.

### Versioning, tags, and releases

Implement a documented, conventional release process using Semantic Versioning. Choose one version-management tool—such as Changesets or Release Please—based on the repository's current conventions; do not add both without a compelling reason.

- Validate the package before a release.
- Ensure tags follow a consistent format such as `v1.2.3`.
- Generate release notes/CHANGELOG from an auditable source.
- Avoid creating duplicate releases or tags.
- Keep version and package metadata synchronized.
- Prefer a PR-based release process where practical, so a maintainer can review the version bump before release.

### npm publishing

- Use npm Trusted Publishing with GitHub Actions OIDC when available and configured; otherwise document the secure setup needed.
- Never hard-code or commit npm tokens.
- Use least-privilege permissions and protect publishing environments where appropriate.
- Publish only after required CI checks pass and the release/tag is verified.
- Do not run a real publish or create a public release during implementation unless the owner explicitly authorizes it.
- Document the required npm and GitHub repository settings for maintainers.

## 13. Documentation and Discoverability

Create professional documentation aimed at developers finding the package through Google, npm search, and GitHub.

Required:

- `README.md` with a concise value proposition, installation, quick start, config reference, examples, generated output tree, supported formats, limitations, troubleshooting, API/CLI usage, contribution instructions, and license.
- A meaningful package description and accurate npm keywords, including relevant terms such as `manifest`, `web-app-manifest`, `pwa`, `icon-generator`, `screenshot-generator`, `sharp`, `typescript`, and `asset-automation`.
- `CHANGELOG.md`.
- `CONTRIBUTING.md`.
- `SECURITY.md`.
- GitHub issue templates for bug reports and feature requests if appropriate.
- Example project/config demonstrating a complete successful run.
- JSDoc for public API and important behavior.
- Clear links between the README, docs, examples, and repository.
- Accurate statements only: do not claim unsupported features, browser compliance, platform support, benchmarks, or security guarantees without evidence.

Do not keyword-stuff. Prioritize clear, useful documentation and a distinct product value proposition. Verify package name availability before publishing, but do not claim it is available unless checked.

## 14. Security and Reliability

- Treat source images, SVGs, config files, and templates as untrusted inputs at file-processing boundaries.
- Set reasonable limits for input file size and image dimensions/pixel counts where appropriate to reduce resource-exhaustion risk.
- Avoid unsafe shell execution and unsafe path concatenation.
- Do not use shell commands built from untrusted filenames.
- Handle filesystem errors with useful diagnostics.
- Prevent partial writes from leaving a broken manifest.
- Clean up temporary files after errors.
- Ensure cleanup affects only files demonstrably managed by Fastifest.
- Do not promise complete protection from malicious inputs; document relevant trust assumptions and limitations.

## 15. Acceptance Criteria

The work is complete only when all applicable criteria below are satisfied:

- [ ] Package has a clear, documented public API and/or CLI.
- [ ] `fastifest.config.ts` is loaded from the consuming project root.
- [ ] Logo discovery supports PNG, JPG, JPEG, and SVG.
- [ ] Screenshot discovery supports PNG, JPG, and JPEG.
- [ ] Input filenames do not need to be specified in config.
- [ ] Image processing uses `sharp`.
- [ ] Standardized icon outputs have deterministic names, formats, and dimensions.
- [ ] Screenshot outputs have deterministic names and preserve aspect ratio by default.
- [ ] `manifest.template.ts` is generated only when configured and is never silently overwritten.
- [ ] Template can define the supported normal manifest fields except the generated collections.
- [ ] `manifest.json` is generated at the project root by default.
- [ ] Manifest asset URLs are web paths, use forward slashes, and point to existing generated assets.
- [ ] Config, public-root, and path traversal validation are implemented and tested.
- [ ] Errors and warnings are actionable.
- [ ] Tests cover unit and end-to-end behavior.
- [ ] Formatting, typecheck, tests, and build pass locally.
- [ ] GitHub Actions quality gates are present and correctly configured.
- [ ] Version/tag/release/publish automation is documented and safe.
- [ ] README, JSDoc, license, changelog, security policy, and contribution guide are present.
- [ ] Package contents are inspected before release.
- [ ] No real npm publish, public release, destructive repository action, or irreversible external change occurred without explicit authorization.

## 16. Execution Protocol for the Coding Agent

Work in the following order:

1. Inspect the repository, current branch, working tree, package manager/runtime versions, and existing conventions.
2. Report any relevant existing work or constraints briefly, then proceed without asking for approval for routine reversible implementation choices.
3. Write a short implementation checklist and identify any genuine blockers.
4. Implement the smallest complete architecture meeting this specification.
5. Add fixtures and tests alongside each core feature.
6. Add documentation and GitHub workflows.
7. Run formatting, typechecking, unit tests, integration tests, build, and package-content checks.
8. Fix failures rather than merely reporting them. If a check cannot run, explain exactly why.
9. Review the final diff for accidental unrelated changes, unsafe file operations, missing files, and inaccurate claims.
10. Summarize the implementation, key decisions, commands/checks run and their results, known limitations, and any manual setup still required.

Do not falsely claim a test, build, package availability check, release, or publish succeeded unless it was actually performed and its result was observed.

## 17. Final Report Format

At completion, report:

1. **Implemented:** major capabilities and files added/changed.
2. **Design decisions:** config loading, template loading, icon/screenshot rules, path validation, runtime support, and release strategy.
3. **Validation results:** each command run and pass/fail status.
4. **Workflows:** what triggers each workflow and any required repository settings.
5. **Remaining limitations:** only real, verified limitations.
6. **Manual steps:** settings or actions the repository owner must perform.
7. **Release status:** explicitly state whether anything was published or released. Default answer must be “No; not authorized” unless explicit authorization was given and the action actually completed.

Begin by inspecting the repository. Then implement and verify the project end to end.
