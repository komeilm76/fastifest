# Maintainer readiness review progress

Updated: 2026-10-30

## Current task

**Phase 4 — verify maintainer guidance and issue forms against the GitHub repository settings; keep them outside the npm package.**

**Status: Complete for the checks accessible in this session; maintainer action remains before security reporting is ready.** The worktree was clean at the start (`2f95834`). Repository metadata reports a public repository, default branch `main`, Issues enabled, and Discussions disabled. GitHub reports private vulnerability reporting is disabled. No alternate private contact is named in the policy or issue forms reviewed. `SECURITY.md` and the issue forms are on this working branch but not on `main`; their GitHub links and forms are not live until merged. Branch protection could not be queried (HTTP 403), so its state remains unknown. No repository settings were changed.

## Findings and actions

- Bug and feature forms are appropriate for an Issues-enabled repository; `blank_issues_enabled: false` directs users through the forms. The security contact link points to `SECURITY.md`, and the user documentation link points to `docs/user/` on `main`.
- Since private vulnerability reporting is disabled and no alternate private contact is published, the security-reporting instructions previously suggested a channel that does not currently exist. Updated `SECURITY.md` to disclose the observed setting and require maintainers to enable private reporting or publish an actual private contact before considering the policy ready. Updated the issue-form contact link description to tell reporters to check that status. This is a documentation correction only; settings were not changed.
- GitHub's contents API returned 404 for `.github/ISSUE_TEMPLATE` and `SECURITY.md` on default branch `main`, and `gh repo view` listed no active issue templates there. These files are present on this working branch and will only be active after merge.
- The branch-protection endpoint returned HTTP 403 (“Resource not accessible by integration”). Protection status is unverified; no inference is made.
- Both CI workflows reviewed use `contents: read` permissions and SHA-pinned third-party actions.

## Verification

- All three issue-form YAML files validated successfully with `yaml`.
- `npm run format:check` passed.
- `npm run package:check` passed: the package allowlist contains 81 files, limited to runtime output and consumer documentation.
- `npm pack --dry-run --json` also listed 81 files and confirmed that `.github/` issue forms, `CONTRIBUTING.md`, `SECURITY.md`, and `docs/developer/` are excluded.
- `git diff --check` passed.

## Next tasks (phase-priority order)

1. **Phase 4 — resolve the private-reporting readiness gap.** A repository maintainer should enable GitHub private vulnerability reporting or supply and publish a private contact route, then update `SECURITY.md` to match the actual setting before merging the forms/policy.
2. **Phase 4 — verify branch protection with an authorized maintainer.** The integration could not read the endpoint; confirm required reviews/status checks and document only verified settings.
3. **Phase 4 — user review and merge readiness.** Review this report and the two documentation changes; after approval, merge through the normal repository process and verify that GitHub recognizes the issue forms and security policy on `main`.
4. **Phase 4 — complete the remaining phase gate.** Reconfirm consumer-facing claims, package allowlist, workflows, and the full local/hosted check set; record any unverified runtime or platform coverage without broadening claims.
5. **Phase 5 — release-readiness review, only after Phase 4 and explicit authorization.** Confirm versioning, package identity/ownership, publishing permissions, workflow security, and release notes. Do not publish without explicit owner authorization.

## Progress log

- 2026-10-30 — Began checking repository settings, local maintainer materials, issue forms, workflow permissions, and npm exclusions. The local forms direct security reports to `SECURITY.md`, but the current repository setting is private vulnerability reporting disabled and no alternate private contact is listed.
- 2026-10-30 — Updated `SECURITY.md` to state the observed private-reporting gap and maintainer action; adjusted the issue-form contact link description. No repository setting was changed.
- 2026-10-30 — Confirmed the forms and security policy are not on default branch `main` yet; checked branch protection but received HTTP 403, leaving that setting unverified.
- 2026-10-30 — YAML validation, `npm run format:check`, `npm run package:check` (81 files), `npm pack --dry-run --json` exclusion check (81 files), and `git diff --check` all passed. Task checks complete; stop for user review.
