# W6-CDX-28: content surfaces on the tokens, visual check

Captured 2026-10-11. Dark theme only, the one theme Codex ships through Wave 6.

## What was burned

Eight `src/index.css` banners went to zero findings: Log Tree (77), Explore / Browse (20),
Page Tree (10), Search (Inline, top bar) (3), Error Boundary (7), Search Results (2), Cards + Grid (1)
and Not Found Log (1). The token-discipline ledger went from 631 to 510
(`node tests/design/report.mjs src/index.css`, total 510, the eight banners absent).

Labels that sit on a translucent tint were measured over all five surfaces, on the default accent and
the eight picker hues (`tests/design/tints.test.js`). Five of them fell below 4.5:1 once the tint sat
under them and stepped one shade lighter (`--cx-warning-bright`, `--cx-danger-bright`,
`--cx-success-bright`, `--cx-violet` lifted, and `--cx-accent-hover` on the Page Tree and Log Tree
rows). The highlight.js comment and keyword hues lifted one step, measured on the code wash
(`tests/design/code-blocks.test.js`). Plan deviations are recorded in the PR 8 section of
`docs/plans/2026-09-24-suite-ui.md`.

## Captures

Each PNG was read by eye. `iris shoot` reported `console_errors []` for every capture, and
`settled False` for the static harness pages, so iris did not confirm a steady state; the images
are static markup, and the reading below is the check.

- `cdx28-content-before-1280.png` and `cdx28-content-after-1280.png`: a throwaway harness of the
  editor (a mention chip, a blockquote, a highlighted code block, a table), the comment sidebar, a
  markdown preview with CI badges, a code embed with a STALE badge, and an issue embed. Before loads
  the branch-base CSS, after loads this branch's CSS; both load the real `core.css`, `codex.css`
  and `index.css`.
- `cdx28-content-diff.png`: the two above differenced. Changed: the comment and keyword hues on both
  code blocks and the embed, the success and failure CI badge labels, and the STALE label. Nothing in
  the comment sidebar, the table or the mention chip moved; those belong to the Comments banner,
  which this PR does not burn.
- `cdx28-nav-before-1280.png` and `cdx28-nav-after-1280.png`: a harness of the Page Tree (an active
  row and the add buttons), the Explore filters, badges and match, a search result and the Log Tree
  add, delete and CI badges. Read after: the active Page Tree label and the add button step to the
  accent-hover shade, the Clear filters label and the content-match badge are lighter, and the
  Favourites filter keeps its label colour (the bright warning is the old #ffc832) while its border and wash shift to the warning tokens.
- `cdx28-404-before-1280.png` and `cdx28-404-after-1280.png`: the real 404 page on the dev server,
  before and after. Pixel-identical: its one change is a same-value rename.

## Not captured

- The logged-in app pages (home, an archive, a page tree, search results, Explore) were rendered as
  the harness above, not in the running app: `iris shoot` cannot carry a session cookie, and no
  browser driver with a login was set up for this session.
- The 390 px widths: `iris shoot` has no viewport flag, and the harness is not a responsive layout.
- The comments and editor canvas banners (Comments & Annotations, Editor Log, Read-only Document View,
  Draw.io, Markdown Editor, Mentions, Version History, Collaborative Editing) are not burned by this
  PR. They are the banners PR 9 leaves in place by the plan.

## Raw

- `raw/design-project.txt`: the full design project run (exit 0).
- `raw/new-tests.txt`: `tints.test.js` and `code-blocks.test.js` (52 of 52).
- `raw/report-after.txt`: the live buckets after the burndown.
- `raw/content-harness.html` and `raw/navigation-harness.html`: the markup behind the harness pages.
