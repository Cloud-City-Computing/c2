# W6-CDX-42: settings and admin (dark theme)

Captured 2026-10-12 against four throwaway Codex instances: the built code at origin/main (`before/`) and this branch
(`after/`), each with suite mode on (`suite-on/`) and off (`suite-off/`). MySQL 8 on a private Docker network with no
published port; the servers listen on 127.0.0.1 only. `raw/capture.mjs` drove headless Chrome over CDP and wrote each
PNG with a JSON probe of the DOM for the state. Every PNG was opened and read by the author (80 in all, 20 per folder).

The seeded admin is issuer-linked in the suite-on instances, so its password sign-in is refused there (by design). The
suite-on capture therefore signs in with a session minted for the same account (`CDX_SESSION_TOKEN`). The issuer name in
the captured UI is a neutral example name, not the product's.

Sizes 1280x860 and 390x844. Dark is the only theme until W6-CDX-43.

## What to look at

- **Account, suite on** (`after/suite-on/account-*`): name, email and password are text, each "Managed by Example ID" with
  a link to the configured account page; the probe finds four managed lines, four links, no text box, no radio, no submit.
  `before/suite-on/account-*` shows the editable fields the server now refuses.
- **Account, suite off** (`after/suite-off/account-*`): editable as before; the Workspaces nav item is present.
- **Admin tabs** (`*/admin-{overview,users,workspaces,squads,invitations,webhooks}-*`): one tab row in the page header, no
  inner sidebar, no pictograph in the page text (probe). At 390 the tabs wrap onto a second line rather than clipping.
  `before/` shows the inner sidebar, the emoji, the stray "0" after each Permissions button (X7), and the clipped
  "+ New Workspace" at 390.
- **Not found** and **first run** (`*/not-found-*`, `*/first-run-*`). The before first run is centred (X5).
- **Notification preferences** at both widths, before and after.

## What the visual pass found, and what was fixed

- The phone shell stretched its two rows to the 100vh minimum, so every page at 390 started about 90 px below the strip
  (before and after this branch). Fixed with `align-content: start` in the phone rule (`tests/design/phone-shell.test.js`).
- The Admin tab row clipped "Invitations" and "Webhooks" at 390 and scrolled sideways. It now wraps.
- The Workspaces panel header pushed "+ New Workspace" off the card at 390. Panel headers now wrap.
- A stray horizontal scrollbar sat under the admin content at 390. The admin main column no longer scrolls sideways.
- The first-run state left its account's name cached, so the admin footer read "eve". The first-run state now runs last.
- The before admin-tab shots first clicked on nothing (emoji in the label), so they showed Overview. Re-captured.

## Not verified here

- The Codex light theme (W6-CDX-43) and the two-cursor document smoke.
- Notification preference copy "Off by default — can be noisy" carries an em dash; it is existing Codex copy, not changed here.
