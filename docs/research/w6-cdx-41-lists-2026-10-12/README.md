# W6-CDX-41: lists, home and the document header (dark theme)

Captured 2026-10-12 against a throwaway Codex: `NODE_ENV=production`, the built `dist/`, the schema from `init.sql` and
`seed.sql`, one scratch archive with no documents added for the empty state, MySQL 8.4.11 in a container on an internal
Docker network with no published port, the app on 127.0.0.1 only. Headless Chrome over CDP through `raw/capture.mjs`
(credentials and the base URL come from the environment; none is committed). Every PNG was opened and read after capture.

- `before/`: the code at `87c5374` (origin/main, A1 to A3 merged), suite mode on.
- `after/`: this branch (after the momus round-one fixes), the same routes and seeded data.
- Sizes 1280x860 and 390x844, dark only (light is W6-CDX-43). The `probe-*` and `*-probe-*` JSON files are geometry.
  The phone edit probe measures read mode too: the Edit control is hidden on a phone, so there is no edit mode there.
- `before/` carries the first capture's PNGs and the editor probes. `after/` also carries the layout probes, which
  diagnosed the phone placeholder fix (see below).

## What changed on screen

- **Archives (X9).** Rows in one panel: name (the row's toggle), squad, owner, document count, and a More actions
  menu. Rename, Manage access and Delete are menu items; Delete is danger text, never a solid red button. Go to squad
  (the old "← Squad") is the first item when the archive has a squad. `after/archives-dark-*`, `after/archives-menu-dark-*`.
  The primary, New Archive, sits in the page header.
- **Empty states.** One component: a Poppins title, one line, an optional action. `after/empty-dark-*` shows an empty
  archive's document tree; Home, Notifications and Activity render the same component (no capture of those, see below).
- **Home.** The hero is gone. A page header ("Home", with a one-line meta) sits over the existing search and grid. The
  card hover is a border change, with no lift or shadow. `after/home-dark-*`.
- **Archive view.** With no document open, the archive's page header (name, squad and workspace) sits above the grid,
  and the tree is headed "Documents" with the tree's rows on the nav-item anatomy (14 px, the selection wash with an
  inset accent ring). `after/archive-view-dark-*`.
- **Document header.** The title (the page h1, renamed in place in edit mode), a faint meta line with the author's
  name and not the email, star and watch as icon buttons, Edit as the one primary in read mode, and the archive crumb.
  The toolbar's emoji (edit, read, save, publish, comment, history, export, the comment manager) are stroke icons.
  `after/document-dark-*`.

## Editor geometry (`probe-read-1280.json`, `probe-edit-1280.json`, settled, 1280 x 860)

| | before | after |
|---|---|---|
| Content column, read | 716 px | 716 px |
| Content column, edit | 708 px | 708 px |
| Editor (`.tiptap`), edit: width x height | 706 x 450 | 706 x 450 |
| Canvas (`.editor-container`), edit: width x height | 708 x 527 | 708 x 527 |
| Canvas, read: width x height | 716 x 458 | 716 x 458 |
| Toolbar top, read / edit | 177 / 183 px | 177 / 183 px |
| Page scroll height, edit (viewport 860) | 868 | 864 |

Read toolbar: the Edit control is gone (it is the header's primary now). Its Export button is 104 px wide (95 before, the
icon and chevron) and 26 px tall (30 before, the emoji line box); the read toolbar is 44 px tall (48). Edit toolbar: every
small button keeps its 26 px height, the icon-only comment manager is 39 x 25 (41 x 26). The canvas moves as a whole
(read 241 to 237 px, edit 285 to 281 px, from the shorter read toolbar); nothing inside it changes size.

The edit page keeps overflowing the 860 px viewport by the same amount as before (scroll height 864 against 868), so its
scrollbar still narrows the column to 708 px. This is deliberate: the plan fixes the column at 708 in edit mode. A shorter
header would fit the page, drop the scrollbar and widen the column to 716 px, which the review ruled out.

## Phone shell (`phone-geometry-390.json`, `phone-geometry-320.json`)

Before, a page shorter than the 100 vh shell stretched the strip's row evenly with the work row: the strip was 283 px tall
on /github at 390, and GitHub's connect card was centred in the gap. The phone shell's rows are now `auto minmax(0, 1fr)`
in the phone block only: the strip stays 90 px, and the work area fills the rest (754 px at 390, 650 px at 320, on /github,
the archive placeholder, Notifications and Activity). /account and /archives, which are longer than the viewport, are the
same as before. The `align-content: start` the review asked about was tried first; it collapsed nothing but moved the
GitHub card to the top, so it was not kept. Desktop and the logged-out shell are untouched.

## What changed on screen

- **Archives (X9).** Rows in one panel: name (the row's toggle), squad, owner, created date (restored from the card),
  document count, and a More actions menu. Rename, Manage access and Delete are menu items, Delete is danger text, never
  a solid red button. Go to squad is the first item when the archive has a squad. A missing count reads "Count
  unavailable", never zero. The primary, New Archive, is in the page header.
- **Focus.** Choosing Rename from the menu closes it and returns focus to the row's trigger before the dialog opens, so
  Escape brings focus back to the trigger (tested with the real `showModal`).
- **Empty states.** One component. `after/empty-dark-*` (an empty archive), `after/notifications-*`, `after/activity-*`,
  and the 320 and 390 captures of the same.
- **Home.** The hero is gone; a page header sits over the existing search and grid. Card hover is a border change.
- **Archive view.** With no document open, the archive's page header sits above the grid, and the tree is headed
  "Documents" on the nav-item anatomy.
- **Document header.** Title (the page h1, renamed in place in edit mode), author's name (never the email), star and watch
  as icon buttons, Edit as the one primary in read mode (the only Edit on the page), and the archive crumb. The toolbar's
  emoji are stroke icons.

## PNGs opened and read

Every file in `after/` and `before/` named below was opened after capture.
- `after/`: archives (1280, 390, 320), archives-menu (390, 320, 1280), home (1280, 390), document (1280, 390),
  archive-view (1280, 390), empty (1280, 390), notifications (1280, 390, 320), activity (1280, 390, 320),
  phone-github, phone-account, phone-archives-1-doc, phone-notifications, phone-activity (390, 320).
- `before/`: the first capture's set plus phone-github, phone-account, phone-archives-1-doc, phone-notifications and
  phone-activity (390, 320).

## Not verified

- The two-cursor smoke (it needs two signed-in browsers and a comment). The editor's comment highlights and remote
  cursors were not measured; the highlight recompute is covered by a unit test with a ResizeObserver mock only.
- Light theme (W6-CDX-43 scope). Workspaces (suite off) is W6-CDX-42's page and was not captured.
- Phone edit mode does not exist (the Edit control is hidden on a phone), so the phone probes measure read mode.
