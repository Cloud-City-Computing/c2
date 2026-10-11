# W6-CDX-29: admin, settings and social surfaces on the tokens, and the UI track retires

Captured 2026-10-11. Dark theme only, the one theme Codex ships through Wave 6.

## What was burned

Nine `src/index.css` banners went to zero, and `src/components/AccountMenu.jsx` lost its five
literals (the Google mark's four fills and the swatch check's white stroke). Before, then after, from
`node tests/design/report.mjs`:

| Banner | Before | After |
|---|---|---|
| Admin Dashboard | 23 | 0 |
| Settings Layout (archive/workspace/squad settings) | 14 | 0 |
| Notification bell | 10 | 0 |
| Archive Access Panel | 8 | 0 |
| Notifications / Activity / Preferences pages | 3 | 0 |
| Watch toggle (editor header) | 3 | 0 |
| User Preferences Panel | 2 | 0 |
| Activity item | 2 | 0 |
| Squad Members Panel | 2 | 0 |
| Export Dropdown | 1 | 0 |
| `AccountMenu.jsx` (file) | 5 | 0 |

The first pass took the ledger from 492 (by its own sum; the earlier "500" note was stale) to 419; the second pass took it to 399 (see below). The live
`index.css` total is 398 and the file-level total 21. `raw/report-after.txt` has the full list.

## What the plan said against what was measured

The plan's expected counts were taken at `91493a6`. Re-measured at this branch's base, Settings
Layout is 14 (plan: 26), Admin Dashboard 23 (plan: 24), the notification bell 10 (plan: 10), and the
others match. The drop is PR 2's dead-CSS deletion and the bridge, as W6-CDX-28 recorded for its own
banners. The Avatar Upload, Archives Management and Account Log banners were already at zero.

## Deviations, each because the measured code required it or the record said so

- **Comments, editor canvas and draw.io were not burned.** The session brief asked for them, but the
  plan (Task 9.1) and the W6-CDX-28 record both say PR 9 leaves the editor canvas in place, and the
  suite UI spec defers it to a later wave, because changing layout around the editor moves every
  comment highlight and remote cursor, and those components have no coverage. They stay in the
  ledger with `_later` notes. This needs Kyle's confirmation if the brief's reading was intended.
- **Four leftovers from earlier sessions stay in the ledger**, named in its `_later` notes: Modal and
  Overlay (5), Login Tabs (1), Signup Validation Styles (3), and the Welcome block that follows the
  toast CSS (11). The plan expected only the editor canvas and GitHub to remain. The Login modal's
  bucket was recorded as burned in PR 6, yet these three banners still hold findings, so that record
  needs reconciling.
- **Labels that sank below 4.5:1 on a wash stepped one shade lighter**, measured in
  `tints.test.js`: the accent labels on the accent washes (the notification bell, the watch toggle,
  the settings and admin active rows, the admin badges, the status badges and the activity doc
  chip) to `--cx-accent-hover`; the success labels on the success washes to `--cx-success-bright`;
  the warning label on the archive warning badge to `--cx-warning-bright`; and the muted badge label
  to `--cx-text-secondary`.
- **New `--cx-` bindings, each at its exact alpha or the hue of the rgba() it replaces**, listed in
  `src/codex.css` and `tests/design/pairs.json`: `--cx-tint-accent-faint` (0.06), `-quiet` (0.1),
  `-lift` (0.14), `-edge` (0.3, a border), `--cx-tint-success-quiet` (0.1), `-mid` (0.15),
  `--cx-tint-danger-quiet` (0.1), `--cx-tint-slate` (0.1), `--cx-tint-neutral` (0.15), and the two
  non-tint values `--cx-white` (a solid white) and `--cx-ring-light` (a pale swatch ring). The
  amber and violet archive washes take the existing warning and violet tints, the blue one the
  accent mid tint, each a small hue shift (for example the amber goes from hue 84 to 71).
- **The owner role badge was a real defect.** Its fill was `var(--accent-color, #4f8fff)`, and
  `--accent-color` resolves to the pale accent, so its white label measured well under 4.5:1. It now
  takes the accent fill with `--cx-on-accent`, the pairing the primary buttons already use, and
  `tints.test.js` measures it on every accent. This is the one visible repaint that is not a
  same-value rewrite. The owner badge renders in WorkspacesPage, AdminPage and the archive access
  panel, so all three change.
- **Component families whose paint changes** (disclosed per the lesson): the owner role badge
  (AdminPage, WorkspacesPage, the archive access panel); the archive access `.badge` family used by
  `ArchiveBrowser.jsx` (its read, write, owner and none badges, the labels only); the admin status and
  role badges (AdminPage and WebhooksPanel, whose base `.status-badge` class is shared); the
  `.btn-danger.btn-ghost:hover` wash (every danger ghost button, same alpha, the hue of the old
  rgba); the `.settings-item.active` and `.user-search__item` rules, which
  `ArchiveBrowser.jsx`, `IssuePickerModal.jsx` and the search widgets also use (same values); and the
  `.panel-status` family, used by `AccountMenu.jsx` and `ArchiveBrowser.jsx` (the success and error
  washes take the new quiet tints; the success label steps to the bright success). The watch toggle
  is only in the editor header.
- **Dynamic class builders checked:** `admin-role-badge--${role}` (owner, admin, member),
  `status-badge--${status}` (pending, accepted, expired) and `webhook-state--${state}` (delivering,
  stalled) emit exactly the classes the rules name, so no rule lost its emitter.
- **Retirement:** the spec and plan are deleted. Their links are gone from `docs/README.md`,
  `docs/specs/README.md` and the roadmap, and the three research READMEs that named the plan now name
  it as retired with `docs/maps/` as the record. The maps `frontend-architecture.md` and
  `build-test-and-ops.md` describe the tokens, the four projects and the ledger. The roadmap's UI row
  is marked shipped without PR numbers, because the PR numbers were not known at execution.

## Second pass: the leftovers, burned here (2026-10-11, same branch)

The coordinator ruled that every `index.css` bucket outside the editor canvas, the comments and the
GitHub surface burns in this PR. Tests went first (`tests/design/leftover-burndown.test.js` pins each of
the 20 declarations to its token, and the ledger was lowered by 20 in the red commit), then the values.

| Bucket | Found | Classification and why |
|---|---|---|
| Modal + Overlay | 5 | Burned. The `#dropdown-backshadow` scrim, the close control's hover, and the modal and textarea focus rings. Not on the editor canvas. |
| Login Tabs | 1 | Burned. The active login tab. |
| Signup Validation Styles | 3 | Burned. The availability hint and its input border, and the password rule check. |
| Toast Notifications | 11 | Burned. Two groups, neither on the canvas: the Welcome subtitle and checkbox, and the presence avatars, dot and tooltip. `PresenceAvatars` renders on the archive and Explore pages (`ArchiveBrowser.jsx`, `ExploreBrowser.jsx`), not inside `.editor-container`. |
| Version History | 5 | Kept, editor-adjacent. It renders on the document page beside the canvas and its restore writes into the canvas, so it moves with the canvas. |
| Read-only Document View | 10 | Kept, editor-adjacent. It shares the canvas's `.tiptap` markup, so a value change in it is a change to the canvas's rendering. |
| Markdown Editor | 2 | Kept, editor. The markdown source pane of the editor. |
| Mentions (inline @user chips) | 2 | Kept, editor canvas. The chip sits inside `.tiptap`. |
| Editor Log | 40 | Kept, editor canvas. |
| Collaborative Editing - Presence UI | 12 | Kept, editor canvas. The live-editing presence inside the document. |
| Remote Cursors - Collaborative Editing | 2 | Kept, editor canvas. Positioned against `.tiptap`; a layout risk the spec defers. |
| Code Block with Language Selector | 3 | Kept, editor canvas. |
| Syntax Highlighting | 8 | Kept, editor canvas. |
| Draw.io Diagram Block | 8 | Kept, editor canvas. |
| Comments & Annotations | 100 | Kept, comments (the spec's deferred annotation family). |
| GitHub Integration | 186 | Kept, GitHub surface (deferred until track E2). |

Left in the ledger as well, outside `index.css`: `util.jsx` (6, the print stylesheet, not a surface
on the page and not in this PR's scope), `Editor.jsx` (4), `CommentForm.jsx` (2),
`CommentHighlights.jsx` (1), `CommentManager.jsx` (2), `CommentSidebar.jsx` (1), `GitHubPage.jsx` (4)
and `CodeEmbedPickerModal.jsx` (1).

The ledger went from 419 to 399 (`raw/report-after-leftovers.txt`). Index.css keeps 378 of them: 192 on
the editor canvas and comments, and 186 on the GitHub surface.

**The PR 6 contradiction.** PR 6's plan recorded "the Login modal's ledger bucket is burned to zero".
The ledger still held Login Tabs (1) and Signup Validation Styles (3) after that PR. Found in this pass
and fixed here.

**Themes.** Codex is dark only through Wave 6 (decision D-V, light mode deferred), so there is no light
capture to take: the captures are the dark theme only. The "both themes" request cannot be met for
these surfaces without building a light theme, which the spec defers.

**Harness artefact, disclosed.** In the modal section the scrim is laid over the whole stage and the
modal panel reads dimmer than it would in the app, in both the before and the after picture. The
dimming is the same in both, so the difference between them is only the scrim, the greens and the
tooltip shadow.

## Second-pass captures

- `cdx29-leftovers-before-1280.png` and `cdx29-leftovers-after-1280.png`: the modal stage, the login
  tabs and signup hints, and the Welcome block, presence avatars and tooltip. Read by eye. Visible:
  the scrim is a blue-grey dark, not black; the "Available" and "At least 12 characters" hints and the
  "Saved." line are a paler green; the presence tooltip's shadow is a little tighter. Everything else
  reads the same.
- `cdx29-leftovers-before-390.png` and `cdx29-leftovers-after-390.png`: the same stack at 390 pixels, after
  read for wrap and clipping. No wrap or clipping difference.

## Captures

Read by eye. These are static harnesses, not the running app: `iris shoot` cannot carry a session
cookie, so the logged-in admin, settings, archive and account pages were rendered as the same class
markup loading the real `core.css`, `codex.css` and `index.css` (the base CSS for "before", this
branch for "after"). Captured with the Chrome binary at 1280 and 390 pixels wide, with the window
height set to show every section.

- `cdx29-admin-before-1280.png` and `cdx29-admin-after-1280.png`: all five sections at desktop
  width. Visible changes: the owner role badge reads with the accent fill and dark label in the
  archive access and admin rows; the archive badge labels (read, write, owner, none) shift to the
  Codex tokens; the active settings row and the admin sidebar item read one shade lighter.
- `cdx29-admin-before-390.png` and `cdx29-admin-after-390.png`: the same at 390 pixels. The admin
  sidebar becomes a horizontal row above the content (the existing max-width 768px rule, unchanged).
- The swatch check: the "before" harness used `--cx-white` for the check mark, which the base CSS
  does not define, so the check is missing in that picture. The shipped base uses `#fff`, which
  renders the same white check. The "after" picture shows the check, which is the real result.

## Not verified

- The logged-in pages in the running app (admin, settings, archive access, the bell with live data,
  Account): not rendered there, because no session was set up. The harness is the same class markup
  and real CSS, not the components' own output.
- The mobile swatch ring and the hover of each accent in a real browser: measured by tests and the
  harness, not hovered.
- Momus review: not run, per the session brief.

## Raw

- `raw/design-project.txt`: the design project run (283 of 283).
- `raw/report-after.txt`: the live buckets after the burndown.
- `raw/ledger-after.json`: the ledger after the burndown.
- `raw/harness.html`: the markup behind the captures.
- `raw/findings.mjs`: the finding lister used to pick each replacement by line.
- `raw/oklch.mjs`: the sRGB to OKLCH converter used for the new washes (it reproduces the existing
  accent wash's `oklch(0.686 0.128 231.9)` exactly).
