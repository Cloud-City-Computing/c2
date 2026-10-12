# W6-CDX-41: lists, home and the document header (dark theme)

Captured 2026-10-12 against a throwaway Codex: `NODE_ENV=production`, the built `dist/`, the schema from `init.sql` and
`seed.sql`, one scratch archive with no documents added for the empty state, MySQL 8.4.11 in a container on an internal
Docker network with no published port, the app on 127.0.0.1 only. Headless Chrome over CDP through `raw/capture.mjs`
(credentials and the base URL come from the environment; none is committed). Every PNG was opened and read after capture.

- `before/`: the code at `87c5374` (origin/main, A1 to A3 merged), suite mode on.
- `after/`: this branch, the same routes and seeded data.
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

## Editor geometry (`probe-read-1280.json`, `probe-edit-1280.json`)

| | before | after |
|---|---|---|
| Content column, read (1280) | 716 px | 716 px |
| Canvas, read: width x height | 716 x 458 at y 241 | 716 x 458 at y 223 |
| Content column, edit (1280) | 708 px | 716 px |
| Editor (tiptap), edit: width x height | 706 x 450 | 714 x 450 |
| Page scroll height, edit | 868 on an 860 viewport | 860 |
| Toolbar buttons, small size | 26 px tall (Edit 69 wide, Save 74, Comment 102) | 26 px tall (Edit 69, Save 74, Comment 102) |
| Export button | 95 x 30 (emoji line box) | 104 x 26 (icon and chevron) |

The canvas keeps its height in both modes and moves only as a whole (the header is 14 px shorter). The toolbar's
Export is 9 px wider, and the read toolbar is 4 px shorter because the emoji no longer set a 30 px line box.

**One change needs Kyle's eye.** In edit mode the before build scrolled the page by 8 px (scrollHeight 868 on an 860
viewport), so its editor column was 708 px wide with a scrollbar. The after build fits the viewport and is 716 px, the
same width as read mode. The plan's rule ("no change to the content column's width at 1280") is broken in edit mode
by that 8 px, and the cause is the page's own overflow, not the canvas.

## Fixes found while capturing

- **Phone shell.** A page shorter than the phone viewport stretched the sidebar's strip row (the shell is 100 vh tall):
  on the archive placeholder at 390 the strip was 155 px and the page began 65 px low. `.app-shell` now sets
  `align-content: start` in the phone block (`layout-probe-*-390.json`, `placeholder-probe-390.json`). This is a shared
  shell rule; it changes nothing on the pages whose content fills the viewport.
- **Placeholder scroll at 1280.** The archive's page header pushed the grid past 860 px, which added a scrollbar.
  `.archive-view--headed` takes the header's height off the grid's minimum height only when no document is open.

## Not verified

- The two-cursor smoke (it needs two signed-in browsers and a comment). The editor's comment highlights and remote
  cursors were not measured; the canvas and tiptap sizes above are the only editor evidence.
- Notifications and Activity empty states, and the Activity rows, were not captured (they are unit-tested only).
- Workspaces (suite off) was not touched: it belongs to W6-CDX-42.
