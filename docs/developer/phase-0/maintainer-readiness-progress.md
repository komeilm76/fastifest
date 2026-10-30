# Maintainer readiness review progress

Updated: 2026-10-30

## Current task

**Phase 4 — verify maintainer guidance and issue forms against the GitHub repository settings; keep them outside the npm package.**

**Status: Security-setting remediation is blocked on maintainer permissions; branch-protection verification is complete.** The worktree was clean at the start (`9171123`). Repository metadata reports a public repository, default branch `main`, Issues enabled, and Discussions disabled. GitHub reports private vulnerability reporting is disabled. No alternate private contact is named in the policy or issue forms reviewed. `SECURITY.md` and the issue forms are on this working branch but not on `main`; their GitHub links and forms are not live until merged. The `main` branch endpoint reports `protected: false` and protection `enabled: false`, with no required status checks; the repository rulesets endpoint (including inherited rulesets) returned an empty list. An attempt to enable private reporting through the GitHub API was rejected with HTTP 403 (“Resource not accessible by integration”); a follow-up read still reports `enabled: false`. No repository settings have been changed.

## Findings and actions

- Bug and feature forms are appropriate for an Issues-enabled repository; `blank_issues_enabled: false` directs users through the forms. The security contact link points to `SECURITY.md`, and the user documentation link points to `docs/user/` on `main`.
- Since private vulnerability reporting is disabled and no alternate private contact is named in the policy or issue forms reviewed, the security-reporting instructions previously suggested a channel that does not currently exist. Updated `SECURITY.md` to disclose the observed setting and require maintainers to enable private reporting or publish an actual private contact before considering the policy ready. Updated the issue-form contact link description to tell reporters to check that status. This is a documentation correction only; settings were not changed.
- GitHub's contents API returned 404 for `.github/ISSUE_TEMPLATE` and `SECURITY.md` on default branch `main`, and `gh repo view` listed no active issue templates there. These files are present on this working branch and will only be active after merge.
- The branch-protection endpoint returned HTTP 403 (“Resource not accessible by integration”), but alternate read endpoints verified the state: `GET /branches/main` reports `protected: false`, `protection.enabled: false`, and no required status checks; `GET /rulesets?includes_parents=true` returned `[]`. Thus no branch protection or repository/inherited rulesets are configured for `main`.
- Both CI workflows reviewed use `contents: read` permissions and SHA-pinned third-party actions.

## Verification

- All three issue-form YAML files validated successfully with `yaml`.
- `npm run format:check` passed.
- `npm run package:check` passed: the package allowlist contains 81 files, limited to runtime output and consumer documentation.
- `npm pack --dry-run --json` also listed 81 files and confirmed that `.github/` issue forms, `CONTRIBUTING.md`, `SECURITY.md`, and `docs/developer/` are excluded.
- `git diff --check` passed.

## Next tasks (phase-priority order)

1. **Phase 4 — maintainer action: resolve the private-reporting readiness gap.** The API integration lacks permission to change repository security settings. A maintainer needs to enable GitHub private vulnerability reporting in repository settings or supply and publish a private contact route, then update `SECURITY.md` to match the actual setup before merging the forms/policy.
2. **Phase 4 — maintainer decision on branch protection.** `main` currently has protection disabled and no rulesets/required checks. An authorized maintainer should decide and configure appropriate review/status-check requirements; no setting was changed.
3. **Phase 4 — user review and merge readiness.** Review this report and the two documentation changes; after approval, merge through the normal repository process and verify that GitHub recognizes the issue forms and security policy on `main`.
4. **Phase 4 — complete the remaining phase gate.** Reconfirm consumer-facing claims, package allowlist, workflows, and the full local/hosted check set; record any unverified runtime or platform coverage without broadening claims.
5. **Phase 5 — release-readiness review, only after Phase 4 and explicit authorization.** Confirm versioning, package identity/ownership, publishing permissions, workflow security, and release notes. Do not publish without explicit owner authorization.

## Progress log

- 2026-10-30 — Began checking repository settings, local maintainer materials, issue forms, workflow permissions, and npm exclusions. The local forms direct security reports to `SECURITY.md`, but the current repository setting is private vulnerability reporting disabled and no alternate private contact is listed.
- 2026-10-30 — Updated `SECURITY.md` to state the observed private-reporting gap and maintainer action; adjusted the issue-form contact link description. No repository setting was changed.
- 2026-10-30 — Confirmed the forms and security policy are not on default branch `main` yet. The dedicated branch-protection endpoint returned HTTP 403; follow-up reads of the branch and rulesets endpoints established that protection and rulesets are disabled.
- 2026-10-30 — YAML validation, `npm run format:check`, `npm run package:check` (81 files), `npm pack --dry-run --json` exclusion check (81 files), and `git diff --check` all passed.
- 2026-10-30 — Follow-up task attempted to enable private reporting using `gh api --method PUT repos/komeilm76/fastifest/private-vulnerability-reporting`; GitHub rejected it with HTTP 403 (“Resource not accessible by integration”). A subsequent GET still returned `{"enabled":false}`. No repository setting changed; an authorized maintainer must enable the setting in GitHub or publish an alternate private route.
- 2026-10-30 — Continued with branch-protection verification using read endpoints. `GET /branches/main` reports `protected: false`, protection disabled, and no required status checks; `GET /rulesets?includes_parents=true` returned `[]`. This confirms `main` has no configured branch protection/rulesets. No settings changed; maintainer action is needed to decide whether to configure them. Stop for user/maintainer review.
