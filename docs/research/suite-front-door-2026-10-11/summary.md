# Suite front door, W6-CDX-26: what was run on 2026-10-11

- Unit and design: `npm test` 152 files, 3511 tests passed. `npm run test:coverage` exit 0.
- Integration (live MySQL 8.4.11, Node 22.23.3, whole-repo mirror): 27 files, 297 tests passed.
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities. `npm run build`: exit 0.
- ShellCheck (`scripts/*.sh`, koalaman/shellcheck:stable): exit 0.
- Real render, dev server in suite mode (SUITE_NAME "Example Suite", OIDC configured against an unreachable
  issuer): `?signedOut=1` shows "You're signed out of Example Suite." and does not bounce. Read in
  `w6cdx26-landing-1280.png` (dark). The Login modal was opened and its tree observed: "Sign in with
  Example Suite" link first, then username, password and Login (ghost). No PNG of the open modal was kept,
  because iris's live session does not write one.
- Not run: the Cloud City ID stack with Cloud Command signed in (Plan Task 6.3). See open-questions G1 to G3.

Raw output: `integration.log`, `cov.log`, `build.log`.
