# Contributing to Fastifest

Fastifest is pre-release and has not been published to npm. Contributions should improve verified behavior without implying a broader runtime or platform guarantee than the project has tested.

## Development setup

- Node.js `>=20.10.0` is the declared floor. Hosted verification covers Node 20, 22, and 24 on Ubuntu, Windows, and macOS; Bun 1.4.4 is tested on Ubuntu only.
- Install the locked development dependencies with Bun 1.4.4:

  ```sh
  bun install --frozen-lockfile
  ```

- Before opening a pull request, run the relevant focused tests and the full checks:

  ```sh
  npm run format:check
  npm run typecheck
  npm test
  npm run build
  node scripts/verify-api-example.mjs
  npm run package:check
  git diff --check
  ```

The Windows-specific path-safety cases run in the hosted Windows workflow and are skipped on other operating systems. Report which commands and runtime versions you actually ran; do not infer compatibility beyond observed results.

## Change guidelines

- For a bug fix, first add a reproducible regression test. Avoid speculative behavior changes without a demonstrated defect.
- Keep consumer documentation in `docs/user/`. Keep plans, decisions, internal specifications, and maintainer notes in `docs/developer/` or other repository-only files.
- Check the npm file allowlist when adding files. Developer materials, issue forms, and repository policy documents must not enter the consumer package accidentally.
- Keep tests network-independent and use temporary project directories. Do not include private project assets, tokens, or unrelated generated output in a report.
- Update `CHANGELOG.md` under **Unreleased** for user-visible behavior changes; do not invent a release date or version.

## Pull requests

A pull request should include the problem or motivation, the behavior changed, regression coverage, commands and runtimes tested, documentation updates, and any remaining limitations. Keep changes focused and call out effects on output compatibility or filesystem behavior.

Do not publish the package, create a public release, or change release credentials/workflows as part of an ordinary contribution. Release and publication require explicit maintainer authorization.
