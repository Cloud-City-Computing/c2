# W6-CDX-42: settings and admin (dark theme)

Captured 2026-10-12 against four throwaway Codex instances: the built code at origin/main (`before/`) and this branch
(`after/`), each with suite mode on (`suite-on/`) and off (`suite-off/`). MySQL 8 in a container on a private Docker
network with no published port; the servers listen on 127.0.0.1 only. The seed (`seed.sql`) and one issuer link for the
seeded admin were loaded; one seeded account had its first run reopened for the first-run state. `raw/capture.mjs` drove
headless Chrome over CDP and wrote each PNG with a JSON probe of the DOM for the state.

Sizes 1280x860 and 390x844. Dark is the only theme until W6-CDX-43.

## What to look at

- **Account, suite on** (`after/suite-on/account-*`): name, email and password are text, each "Managed by Cloud City ID"
  with a link to the configured account page; two-factor is text with the same line (probe: four managed lines, four links,
  no text box, no radio, no submit). `before/suite-on/account-*` shows the editable fields the server now refuses.
- **Account, suite off** (`after/suite-off/account-*`): editable as before; the Workspaces nav item is present.
- **Admin tabs** (`after/*/admin-{overview,users,workspaces,squads,invitations,webhooks}-*`): one tab row in the page
  header, no inner sidebar, no pictograph in the page text (probe), and Revoke opens a confirm (not captured as a state).
- **Not found** and **first run** (`after/suite-on/not-found-*`, `first-run-*`).
- **Notification preferences** at both widths, before and after.

## Known capture artifact

In the admin-tab and not-found shots the footer name can show the first-run account rather than the admin, because the
app caches the signed-in name across the cookie change the first-run state makes. The admin content is the admin's (the
Users, Invitations and Overview data are the admin's). The first-run state clears local storage before it reads the
first-run account; the cached footer name in the later states is not corrected.

## Not verified here

- The backup-restore integration project fails 21 of 22 on this box, identically on origin/main: the host `mysqldump`
  prints a MariaDB deprecation notice and the drill treats it as a failure. Every other integration file passes (288 tests).
- The Codex light theme (W6-CDX-43) and the two-cursor document smoke.
- Only some of the PNGs were opened and read by the author; the rest are described by their probe files.
