# W6-CDX-27: the Linked tasks link, checked

Evidence for PR 7 of `docs/plans/2026-09-24-suite-ui.md`.

## What was looked at

- `doc-1280.png`: the editor page for document 1 (`/archives/1/doc/1`), signed in as a seeded user,
  in suite mode (`SUITE_COMMAND_WORKSPACE_URL=https://command.example.test/w/1`,
  `SUITE_NAME=Example Suite`). The "Linked tasks" link sits in the meta line after
  "Created by" and the version, underlined in the accent colour. The first-run dialog was
  dismissed first.
- `doc-390.png`: the same page at 390 wide. The link wraps onto the meta line with the star and
  the bell, and nothing overlaps.
- `doc-off-1280.png`: the same page with suite mode off. The DOM holds no `.suite-doc-link`.

The capture script is `raw/capture-script.mjs`. It logs in through `/api/login`, injects the
session cookie over CDP, and reports the link's text, href and tab index. The href read from the
page was `https://command.example.test/w/1/docs/1/1`, with tab index 0 (a native anchor).

## Checks run

- `raw/unit-output.txt`: 131 files, 2845 tests passed (`npm run test:coverage`).
- `raw/integration-output.txt`: 17 files, 195 tests passed, with `backup-restore.test.js`
  excluded.
- `raw/backup-restore-local-output.txt`: that excluded file fails on this machine because the
  local `mysqldump` is MariaDB's; the test says so itself. CI's runner image has MySQL's
  clients, so this is an environment gap, not a change in this PR.

## Re-check after the review round

The same capture after the review fixes (`raw/` holds the rerun counts): the link still renders on
document 1 and document 2 with each document's own archive and log ids, and the server answered
the workspace URL shape at boot. Unit: 131 files, 2858 tests. Integration without the backup drill:
17 files, 195 tests. Full notes in the PR 7 section of the plan.
