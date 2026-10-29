# Requirements and design decisions

This document is the proposed v1 behavioral contract. Any deliberate change during implementation must be recorded here and reflected in tests and user documentation. “Must” denotes a v1 requirement; “proposed” denotes a decision for review before implementation.

## 1. Product boundaries

Fastifest is a local project tool that discovers one source logo and zero or more screenshots, transforms them into predictable public assets, and writes a Web App Manifest. It is not a web server, bundler integration, hosted service, image editor, or browser compatibility validator.

V1 prioritizes deterministic output, explicit ownership of generated files, useful failures, and a small API. Exclude GUI, plugins, AI, parallel/distributed processing, framework-specific adapters, and a cache.

## 2. Proposed configuration contract

Use a TypeScript default export in `fastifest.config.ts`. Resolve config, source-input, and template paths against the project root (`cwd`), never against the installed package or config file's directory. Resolve `paths.manifest` and generated output subpaths against `paths.public`; that public root is itself project-root-relative. `--config` is resolved against `cwd` unless absolute. The config is executable code and must be trusted.

```ts
import type { FastifestConfig } from "fastifest";

export default {
  paths: {
    logos: "./assets/logos",
    screenshots: "./assets/screenshots",
    public: "./public",
    manifest: "./manifest.json",
    output: {
      logos: "./icons",
      screenshots: "./screenshots",
    },
  },
  template: {
    enabled: true,
    path: "./manifest.template.ts",
  },
  images: { overwrite: true },
  logging: { level: "info" },
} satisfies FastifestConfig;
```

Optional screenshot annotations are configured separately from discovery and keyed by the exact source basename:

```ts
screenshots: {
  metadata: {
    'home.png': {
      label: 'Home screen showing the main dashboard',
      formFactor: 'wide',
    },
  },
}
```

This mapping does not select inputs: all supported screenshots are still discovered automatically. Keys match exact source basenames. Each record may contain a non-empty accessible `label` and/or `formFactor: 'narrow' | 'wide'`. Reject metadata keys that do not match a discovered screenshot. Do not infer labels or form factors from the filename or dimensions.

### Path semantics

- `paths.public` is the web-served asset root, default `./public`.
- `paths.output.logos` and `.screenshots` are **relative to the public root**, default `./icons` and `./screenshots`. They may not escape the public root after normalization or symlink checks.
- `paths.manifest` is relative to the configured public root and must resolve to the direct child `manifest.json` in v1. Default `./manifest.json`. Reject absolute paths, traversal, and nested locations clearly. This keeps the manifest in the served asset tree beside generated assets.
- Source directories are relative to project root. `logos` is required; `screenshots` is optional. Logo and screenshot input directories must not equal or contain one another; neither may overlap generated output trees. Do not follow symlinked input entries. Reject symlink/reparse-point components in output roots and reserved output targets, and verify canonical output parents remain inside the public root before writing; do not write through symlinks. Re-check paths immediately before commit where practical. Document that filesystem race/TOCTOU protection is not absolute.
- Browser-resolved `src` URLs are relative to the **deployed manifest URL**, not the public filesystem root. Emit relative URL paths with `/` separators and no filesystem paths; with the default deployment, `public/manifest.json` is served at `/manifest.json`, and `icons/icon-192.png` resolves to `/icons/icon-192.png`. This requires the configured public root and its output subpaths to be served at the corresponding URL paths. Document that Fastifest cannot infer framework/host URL rewrites; users with a different mapping must configure routes or adjust deployment.
- Reject output directories that alias the input directories, manifest, project root, or one another. Test both POSIX and Windows path rules.

### Defaults and validation

- If no config exists, load documented defaults including `./assets/logos`; fail with a concise example if the required logo directory is missing or invalid.
- `template.enabled` controls only create-if-missing scaffolding; it does not disable template loading. Proposed default is `true`: create the starter if missing, print next steps, and exit without manifest generation on that first run. If `enabled` is `false` and the template is missing, fail with an actionable error; if the file exists, load and validate it normally. Never overwrite an existing template, and never use an incomplete starter as manifest data.
- Logging levels: `error`, `warn`, `info`, `debug`, default `info`. Invalid values fail config validation.
- Reject unknown top-level config keys and malformed nested values with field-specific errors (or explicitly document any intentionally extensible section).
- `images.overwrite: true` is the proposed default and applies only to managed image outputs. With `false`, preflight all reserved image outputs that would be written, replaced, or removed (including stale screenshots) and fail without filesystem changes if any exist. The manifest is regenerated from validated inputs/template; the template is never overwritten. Overwrite never authorizes replacing files outside reserved image names.

## 3. Input discovery and selection

- Discover direct children only; no recursive traversal in v1.
- Case-insensitive supported suffixes: logos `.png`, `.jpg`, `.jpeg`, `.svg`; screenshots `.png`, `.jpg`, `.jpeg`.
- Normalize basenames to Unicode NFC; sort by locale-independent lowercase basename using code-point order, then use the normalized original basename as a code-point tie-breaker. Do not rely on locale-sensitive sorting or filesystem enumeration order.
- Ignore unsupported files with one concise warning per directory (not an unbounded log per entry). Every supported-extension file must decode successfully; a corrupt file or extension/content-type mismatch is a fatal, path-specific error, not a silently skipped candidate.
- Require exactly one usable logo. Zero is fatal; more than one is fatal with sorted candidates and guidance to keep only the primary logo. This avoids implicit logo choice.
- Missing screenshot directory and an empty screenshot directory both produce a warning. If there are no screenshots, omit the manifest's `screenshots` member entirely; do not emit an empty array or placeholder entries.
- Do not follow symlinks. Enforce the proposed fixed input limits in the Phase 0 review table before expensive transformations; expose configuration options only if a real use case justifies them.

## 4. Image behavior and naming

Use `sharp`; read actual metadata and fail with the source path if a supported input cannot be decoded. Apply EXIF orientation before measuring, fitting, or resizing raster images; convert output pixels to sRGB; strip source metadata (including EXIF) from outputs. Record manifest dimensions after orientation and processing. Keep diagnostic internals concise and do not expose environment or config contents.

### Logo outputs

Proposed fixed outputs, emitted in PNG:

| File                    | Dimensions | Manifest purpose |
| ----------------------- | ---------: | ---------------- |
| `icon-192.png`          |  192 × 192 | `any`            |
| `icon-512.png`          |  512 × 512 | `any`            |
| `icon-maskable-192.png` |  192 × 192 | `maskable`       |
| `icon-maskable-512.png` |  512 × 512 | `maskable`       |

Preserve the whole logo and aspect ratio by fitting it on a transparent square canvas; never stretch or crop. Maskable variants use a transparent canvas and keep all visible logo content inside the central safe zone: a circle centered in the canvas with a diameter of 80% of the canvas size. This is stricter than merely leaving 10% padding on each straight edge, because corner content can still be clipped by circular masks. The fitting algorithm must account for the artwork's visible bounds (or conservatively fit its full source bounds) and be tested for wide, tall, square, and transparent logos. Document that transparency and logo shape affect appearance. Emit a low-source-resolution warning when the decoded source is smaller than a requested output; do not fail solely for upscaling.

Sanitize SVG processing: enforce the 2 MiB byte limit, reject remote/external file references, bound parsing and rasterization work, and rasterize only to the fixed icon output sizes. Do not allocate a bitmap based on untrusted SVG-declared dimensions. Use the image library without shell execution. Preserve alpha, normalize output color to sRGB, and strip source metadata.

### Screenshot outputs

- Convert to PNG with deterministic names `screenshot-01.png`, `screenshot-02.png`, etc., in discovery order.
- Preserve aspect ratio, never crop, do not upscale. Proposed maximum longest side: 4,096 pixels; shrink larger inputs proportionally, then record the output's actual dimensions.
- Strip metadata; preserve alpha if present.
- Screenshot manifest entries contain output `src`, actual `sizes`, and `type: 'image/png'`. An explicit source-basename mapping may provide `label` and `form_factor`; do not infer them. If no screenshot files are discovered, omit the `screenshots` member.

### Managed output ownership and reruns

Reserve only the exact generated filenames above and the `screenshot-NN.png` pattern (two-or-more digits) within the configured output directories for Fastifest. Never recursively delete directories. After the new manifest is committed, stale matching screenshot files may be removed only from the dedicated screenshot output directory. Unrecognized files are untouched. If a reserved name collides with a hand-managed file, overwrite behavior applies to that name; tell users to keep output directories dedicated and treat all reserved names as Fastifest-owned.

`overwrite: false` performs a preflight check and fails before changing outputs or manifest if any reserved output would be written, replaced, or removed (including stale screenshot files). Prepare all new files in temporary directories on the same filesystem. Replace generated assets first, then atomically replace the manifest; only after the manifest commit remove stale matching screenshot files. On a caught commit failure, attempt to restore replaced files from backups and clean temporary files. Multi-file replacement cannot be fully atomic across process crashes or power loss: preserve the previous manifest file, report any possible partial asset update, and make rerunning generation safe. If stale-file removal fails after commit, keep the valid new manifest and report orphaned managed files as a warning.

## 5. Manifest template and output

`manifest.template.ts` exports a default plain object. Use a declared, tested TypeScript loader for the supported runtime(s); do not rely on experimental undocumented loader flags. Evaluate config and template at most once per run. Both files are executable code and must come from trusted projects.

The template owns ordinary manifest properties. Fastifest owns `icons` and `screenshots` and rejects either key in template data at runtime. TypeScript types should make accidental inclusion difficult, but runtime validation is authoritative because structural typing and JavaScript callers can bypass compile-time restrictions.

Preserve developer-supplied JSON-compatible manifest properties. Validate known Web App Manifest fields and nested values by type against a documented, versioned spec/schema snapshot. As a Fastifest usability rule, require at least one of `name` or `short_name`; do not impose a 12-character maximum on `short_name` or present that common recommendation as a Web Manifest requirement. Preserve unknown JSON-compatible extension members, but state that Fastifest cannot semantically validate those extensions and does not guarantee browser conformance.

Validate URL relationships that can be checked without knowing the consuming site's actual origin: when `start_url` is supplied, it must resolve same-origin with the manifest URL; if `scope` is also supplied, it must resolve same-origin and contain `start_url`; if `id` is supplied, it must be same-origin with `start_url` but need not be within `scope`. Relative values resolve according to Web App Manifest rules. If `start_url` is omitted, browsers can fall back to the linking page, so warn that scope/ID relationships cannot be fully checked. Do not synthesize an `id`; changing it can change installed-app identity.

Generate output as UTF-8 JSON with two-space indentation and a trailing newline. Generated icon metadata includes `src`, `sizes`, `type: 'image/png'`, and the appropriate `purpose`. Check every referenced asset exists inside the configured public root before writing the manifest. No old manifest fields are merged implicitly; the configured template plus newly generated collections are the sole source of output.

Template creation is create-only. If it already exists, leave bytes untouched. With generation enabled, a missing template is created safely, but the starter is not treated as valid manifest metadata: print next-step guidance and exit without writing a manifest on the first run. With generation disabled and no template present, fail clearly.

## 6. API, CLI, runtime

One core operation backs the API and CLI. Proposed API:

```ts
await generateManifest({
  cwd: process.cwd(),
  configPath: "./fastifest.config.ts",
});
```

The CLI's default command generates, `--config <path>` selects a config, `--help` explains usage, and `--version` prints package version. Exit status is zero only on successful generation; validation or I/O errors return non-zero. Avoid success-shaped partial results.

Use Bun for development, scripts, and CI. The npm-consumer engine floor is Node.js `>=20.10.0`, declared after the exact-floor packed-install generation smoke passed on Ubuntu, Windows, and macOS; full candidate checks passed on Node 20, 22, and 24 on those runner OSes. Node 20.9.0 fails to parse the JSON import-attribute syntax in the installed Sharp entrypoint despite Sharp's broader engine metadata. Avoid making Bun a package-consumer requirement; its full checks currently pass on Ubuntu only, so do not claim Windows/macOS Bun compatibility. Use `sharp` as the native image dependency and retain the tested OS/runtime limits in public docs.

## 7. Diagnostics and performance

Report actionable context: field/path, expected form, and next step. Distinguish fatal errors and warnings; summarize discovered inputs, generated outputs, warning count, and elapsed time. Never dump entire config objects or secrets.

Use bounded input size and pixel limits, sequential or bounded-concurrency image processing, and avoid decoding the same source more than necessary. Do not add caching in v1. Performance tests should check resource bounds and avoid brittle timing thresholds; benchmark claims require measured evidence.

## 8. Release and package policy

Keep runtime dependencies small; use Bun for development, TypeScript, Vitest, formatter, and JSDoc. Publish compiled runtime files and required declarations only. Verify `files`, `exports`, `types`, `bin`, license, package contents, and native `sharp` install behavior before release. Add MIT license unless owner or repository policy specifies otherwise.

Start with a documented, reviewable manual SemVer/tag process. Defer adding a versioning bot until maintainers explicitly want automated release PRs, and then choose one tool only. CI must not publish from pull requests. Prefer npm Trusted Publishing with GitHub Actions OIDC; document required repository/npm settings. Do not publish, create a release, or make irreversible external changes during implementation without explicit authorization. Do not claim npm name availability without an actual verified check.

## 9. Error and failure guarantees

- Validate configuration, paths, template values, and input metadata before committing the final manifest.
- Do not overwrite a pre-existing template.
- Do not delete files outside reserved managed output names and directories.
- Keep the previous manifest intact if asset generation or validation fails.
- Clean temporary files in failure paths.
- Report when an asset stage partially changed despite manifest preservation; do not promise an all-or-nothing multi-file transaction.
- Never claim protection against every malicious config, template, SVG, image, filesystem race, or native-library vulnerability. Document trust assumptions.

## 10. Open decisions for Phase 0 review

The following are explicit proposals, not implemented behavior. Confirm or change them before implementation; the agent must not silently choose a different contract.

| Topic                 | Proposed v1 decision                                                                                                                                                                                                                                                                                                                                                                                                                                     | Why it matters                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo input default    | `./assets/logos`; fail with a clear message if missing or if it does not contain exactly one usable logo.                                                                                                                                                                                                                                                                                                                                                | Makes the quick start conventional and discoverable without guessing a logo.                                                                                              |
| First template run    | With template generation enabled, create the starter if absent, print next steps, and exit without creating a manifest. On the next run, load and validate the existing template.                                                                                                                                                                                                                                                                        | Avoids generating an incomplete/placeholder manifest and avoids silently overwriting user data.                                                                           |
| Developer metadata    | Require at least `name` or `short_name` as a Fastifest usability rule; validate known field types. Do not impose a 12-character limit on `short_name` as though it were a Web Manifest requirement.                                                                                                                                                                                                                                                      | Separates product guidance from standards validation.                                                                                                                     |
| Resource limits       | Per-file byte limit 20 MiB; decoded raster limit 40 megapixels and 12,000 pixels per side; SVG byte limit 2 MiB; screenshots resized proportionally to a 4,096-pixel maximum side. Process inputs sequentially.                                                                                                                                                                                                                                          | Gives users a predictable ceiling and reduces resource-exhaustion risk while supporting common assets. Adjust only with evidence/tests.                                   |
| Screenshot metadata   | Add optional `screenshots.metadata`, keyed by exact source basename, for explicit `label` and `formFactor` values. Discovery remains automatic; metadata must not be guessed from image dimensions or filenames. Reject map keys that do not match a discovered screenshot. Omit these optional fields when not supplied.                                                                                                                                | `label` is recommended for screenshot accessibility; `form_factor` should be present only when the developer knows the intended layout.                                   |
| PWA guidance warnings | Warn, but do not fail, when `start_url` or both `display`/`display_override` are absent, or when `prefer_related_applications` is `true`.                                                                                                                                                                                                                                                                                                                | These fields are optional in the Web Manifest, but their absence/values can affect install promotion in Chromium; warnings must not imply universal installability rules. |
| Output overwrite      | Keep `images.overwrite: true` as the ergonomic default; it applies only to managed image outputs. With `false`, preflight all reserved image outputs that would be written, replaced, or removed (including stale screenshots) and fail without filesystem changes if any exist. The manifest is regenerated from validated inputs/template; the template is never overwritten. Overwrite never authorizes replacing files outside reserved image names. | Makes repeat runs convenient while clearly defining ownership and collision behavior.                                                                                     |
| Release automation    | Defer selecting Changesets or another versioning bot until release readiness; document a manual SemVer/tag workflow first. Add one tool only if maintainers want automated release PRs.                                                                                                                                                                                                                                                                  | Avoids installing release infrastructure before package behavior and ownership are settled.                                                                               |

Proposed requirements above are suitable for review and test design; they become the contract only after Phase 0 approval. Supported runtime ranges and TypeScript loader dependency remain engineering choices to prove in implementation/CI, not user-facing promises.
