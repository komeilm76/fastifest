# Developer documentation

This directory is for maintainers and contributors. It contains internal planning, implementation requirements, and delivery tasks. It is **not part of the package's user documentation** and must not be exposed from the npm-facing README.

## Phase 0

- [Phase 0 overview and review gate](phase-0/README.md)
- [Requirements and design decisions](phase-0/decisions.md)
- [Delivery plan and phase gates](phase-0/delivery-plan.md)
- [Refined implementation specification](specification.md)

## Documentation boundary for npm

The package's consumer-facing documentation is the root `README.md` and `docs/user/**`. Keep those pages practical, concise, and limited to behavior verified against the released package. The npm-facing README must link only to user guides.

When package metadata is introduced, use an explicit npm `files` allowlist (for example, `dist/**`, `docs/user/**`, `README.md`, and the required license/package metadata). Do not include `docs/developer/**`, phase checklists, decision logs, implementation specifications, or internal planning in the published tarball. Verify the boundary with `npm pack --dry-run` and inspect the resulting file list before release. Confirm that every user-guide link in the npm-rendered README resolves; use canonical repository links if relative Markdown links are not rendered as intended. Before publishing, remove pre-release notices only after implementation and every documented example have been verified. Do not rely on `.npmignore` rules alone when an explicit allowlist is available.

Internal implementation changes that affect public behavior must still be reflected in user docs, but internal rationale and task tracking remain here.
