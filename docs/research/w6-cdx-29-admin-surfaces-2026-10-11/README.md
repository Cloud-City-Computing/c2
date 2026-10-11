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
  spec's deferred list names it, because changing layout around the editor moves every comment highlight
  and remote cursor, and those components have no coverage. They stay in the ledger with `_later` notes
  that point at the roadmap row UI-later. The orchestrator confirmed this deferral per the plan.
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
  "Saved." line are a paler green; the presence tooltip's shadow is a little tighter. The record of
  every rewrite that is not a same-value change is in the review-round section below, which corrects
  the earlier claim that everything else reads the same.
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

## Review round (momus findings, 2026-10-11, same branch)

Each item below was fixed on this branch, tests first where behaviour changed. The earlier claim that
"everything else reads the same" was wrong: every rewrite that is not a same-value change is recorded
here, and the CHANGELOG repeats the list.

### Presence avatars: the label is chosen per cursor colour

The initial on a presence avatar was white on every cursor colour. White reads poorly on most of the
palette (`#ffa500` measures 1.97:1 and `#8bc34a` 2.10:1 before this fix). `src/lib/avatar-label.js`
chooses, per colour, the first of white (`--cx-white`), the dark ink (`--cx-on-accent`) or black
(`--cx-ink-deep`) that clears 4.5:1. The palette now lives in `services/cursor-colors.js`, shared by
`services/collab.js` and the helper. `PresenceAvatars.jsx` sets the label inline on each avatar and the
tooltip avatar. `tests/design/presence-palette.test.js` walks every colour, resolves each label through
the real tokens and measures it with the vendored gate.

| Cursor colour | White | Ink (`--cx-on-accent`) | Black | Chosen | Chosen ratio |
|---|---|---|---|---|---|
| `#2ca7db` | 2.74 | 7.06 | 7.66 | ink | 7.06 |
| `#e5544e` | 3.68 | 5.26 | 5.71 | ink | 5.26 |
| `#50c878` | 2.13 | 9.10 | 9.87 | ink | 9.10 |
| `#ffa500` | 1.97 | 9.80 | 10.63 | ink | 9.80 |
| `#9b59b6` | 4.67 | 4.15 | 4.50 | white | 4.67 |
| `#e91e63` | 4.35 | 4.45 | 4.83 | black | 4.83 |
| `#00bcd4` | 2.30 | 8.43 | 9.14 | ink | 8.43 |
| `#8bc34a` | 2.10 | 9.22 | 10.00 | ink | 9.22 |
| `#ff5722` | 3.16 | 6.12 | 6.64 | ink | 6.12 |
| `#607d8b` | 4.37 | 4.43 | 4.80 | black | 4.80 |

Neither white nor the ink clears 4.5:1 on `#e91e63` or `#607d8b`, so black is the third candidate, and
it is a new token (`--cx-ink-deep`, decorative in `pairs.json`). Changing those two cursor colours
instead would change the product's palette, so it was not done. The ratios in the table are the vendored
gate's own measurements (`presence-palette.test.js` asserts the chosen label on each colour).

### The rewrites that are not same-value (recorded, not reverted)

- **`.badge-info` label.** It was `--cx-accent-hover`, which follows the picked accent, so an info badge
  changed hue with the user's accent. It is now `--cx-info-bright`, bound to the package's fixed accent
  step (`var(--accent-200)`), so the info badge keeps its hue whatever the accent. Its wash
  (`--cx-tint-accent-mid`) was already the fixed blue. Pinned in `tints.test.js`.
- **`.presence-tooltip` background.** The rule read `var(--bg-secondary, #2a2a3e)`, and `--bg-secondary`
  is not declared, so the tooltip painted `#2a2a3e`. It now paints `--bg-panel` (the Codex panel step,
  `--cx-surface-2`), a little lighter than the old literal.
- **`.presence-avatar` border.** The rule read `var(--bg-primary, #1a1a2e)`, and `--bg-primary` is not
  declared, so the ring painted `#1a1a2e`. It now paints `--cx-surface-0`, the page surface the avatar
  sits on. The ring is a little lighter than the old navy.
- **`.setup-checkbox` accent.** The rule read `accent-color: var(--accent, #4a9eff)`, and `--accent` is
  not declared, so the checkbox was always `#4a9eff`. It now reads `--cx-accent`, so the checkbox
  follows the picked accent. This is a deliberate choice and is visible: a Nova or Aurora pick now
  recolours the Welcome checkbox. Kyle may prefer the old fixed blue; that would be `var(--cx-info)`.
- **`.notification-bell__action` label.** The label was `--cx-accent`. The action's hover paints the
  accent wash behind it, and the label measured 4.26:1 on the strongest surface. The rule has one colour,
  so the label steps to `--cx-accent-hover` for the rest state as well as the hover (the rest state is
  not on a wash, so it is only a shade lighter). The same step applies to the other accent labels on
  washes; the shell labels below were found by the derived scan.
- **Shell labels found by the derived scan.** `.cc-suite__link:hover`, `.sidebar__link.active` and
  `.account-button:hover` painted `--cx-accent` on an accent wash, measuring 4.49, 4.49 and 4.26:1. They
  now paint `--cx-accent-hover`. These are suite-chrome rules (W6-CDX-25), not part of this PR's banners,
  and the derived test is what found them.
- **The scrim is shared.** `--cx-scrim` replaces `rgba(0, 0, 0, 0.6)` on `#dropdown-backshadow`, and
  `#modal-dimmer` already paints `--cx-scrim`. The scrim is the shared dialog primitive, so every dialog
  repaints with it, including the GitHub and editor dialogs that are deferred. Their scrim changes from
  black to the blue-grey Codex scrim, with no other change to those dialogs.
- **Presence avatar labels** (the palette table above). Initials on the light cursor colours are dark
  now, where they were white (about 2:1 on orange and green).

### btn-watch stays burned

`.btn-watch` renders in the editor header at `Editor.jsx:1167`, outside the canvas. Its change is colour
only (`--brand-blue` to `--cx-accent`, and the wash to a token), with no layout, position or structure
change, and the rule's label is measured on its wash in `tints.test.js`. The spec defers the editor
canvas and the families on it, not every control near it. So the watch toggle is burned.

### The classification rule, so the two calls agree

Deferral is by family, as the spec names it: the canvas and its annotation, syntax and diff families,
the comments, and the GitHub surface. A control in the editor's header or toolbar chrome is not one of
those families, so it burns when its change is colour-only and measured. The Version History panel is
part of the document page's surfaces, and its restore writes into the canvas, so it stays with the
canvas: its five findings are not a colour-only change to a control, they are the panel the spec
defers with the canvas.

### Mutation check on the derived tint scan

The tint list is now derived from `src/index.css`: every rule whose background reads a `--cx-tint-`
name is measured, with its label taken from its own rule, its bare selector, or the inherited-label
table. A new wash with a failing label was added as `.zz-mutation-wash { background:
var(--cx-tint-accent-mid); color: var(--cx-surface-1); }`. Before the revert the file had 1 match for
the rule; the tints test went red naming `.zz-mutation-wash` (1.37:1 on `--cx-surface-0`); the file was
restored byte for byte (0 matches, `cmp` clean) and the test passed again (53 of 53).

### Deferred bare washes

The derived scan also checks that no translucent background sits bare on an element that sets a colour.
Twenty-eight such rules exist, all in the deferred families (GitHub, the editor canvas and its
toolbar and status, the comments, the read-only document, and the Version History badge). They are
listed by name in `tints.test.js` (`DEFERRED_BARE`) with the reason, so a new bare wash outside the
list fails.
