# W6-CDX-40: the sidebar-led shell (dark theme)

Captured 2026-10-12 against a throwaway Codex (`NODE_ENV=production`, the built `dist/`, seeded with `seed.sql`, MySQL 8.4 in a
container on a private Docker network with no published port, the app on 127.0.0.1 only). Headless Chrome over CDP;
`raw/capture.mjs` produced every PNG and JSON, and every PNG was opened and read after capture.

- `before/`: the code at `1da5d99` (origin/main, A1 and A2 merged), suite mode on.
- `after/`: this branch, suite mode on, the same routes and seeded data.
- `after-suite-off/`: this branch with suite mode off, plus `suite-off-dom.json` (what the sidebar renders).
- Sizes: 1280x860 and 390x844, and 320x740 for the phone strip (home only). Light is W6-CDX-43.

## What changed on screen

- **One sidebar, no top bar, no copyright footer, no bottom tab bar** (K1, K2). `before/document-*` and `after/document-*`.
- **Suite cluster** with the product mark as an SVG (K10). **Workspace slot**, then **"Search or jump to"** with a Ctrl K hint.
- **Navigation:** Home, Activity, Notifications with its unread count (K5; no count in the seeded account, so the pill is
  covered by the unit tests), GitHub when linked, then an **Archives** group. Workspaces is absent in suite mode (K9),
  present with suite mode off (`suite-off-dom.json`).
- **Account footer:** avatar, name (ellipsised) as a menu button, sign-out as an icon button. Admin appears in the menu for
  an admin.
- **Overlays:** `switcher-open-*` (the suite switcher opens inline in the sidebar), `account-menu-open-*` (non-modal, no
  dimming), `search-palette-*` (a modal dialog, documents and archives). Probes: `account-menu-open-probe-1280.json`,
  `search-palette-probe-1280.json`, `search-palette-closed-1280.json`.
- **Phone strip (K2)**, `after/home-dark-390x844.png` and `after/home-dark-320x740.png`: row one is the cluster, the
  workspace slot (ellipsised) and the search icon; row two is the navigation from the left edge, scrolling behind a fade
  with its scrollbar hidden, and the account avatar at its end.
- **Page headers** on Account, Notifications, Notification preferences and Activity (Poppins 24 px title). The other pages
  keep their own headers until W6-CDX-41 and W6-CDX-42.

## Geometry of the deferred editor (the document, 1280)

`before/geometry-editor.json` and `after/geometry-editor.json`, taken after a 2.5 s settle, one browser each.

| Box | Before (x, y, w, h) | After (x, y, w, h) |
|---|---|---|
| main column | 220, 56, 1060, 760 | 248, 0, 1032, 860 |
| `.editor-container` | 252, 277, 996, 494.64 | 266, 221, 996, 494.64 |
| `.tiptap` | 253, 321, 994, 449.64 | 267, 265, 994, 449.64 |
| toolbar | 252, 211, 996, 50 | 266, 155, 996, 50 |

The content column keeps 996 px. Relative to the canvas, the toolbar sits at (0, -66) and the editor body at (1, 44) in both
builds, and the children of the container are the same sizes. The canvas moved (+14, -56) as a whole; nothing inside it
changed size or position relative to it. The sidebar is 248 px, and the main padding became 18 px to keep the column.

Comment highlights: in both builds the seeded comment highlight sits on the same text ("RESTful endpoints ... Acme ecosystem").
Remote cursors were not in any capture.

## Not verified here

- **The two-cursor smoke** (two signed-in browsers, a comment, a remote cursor). Not run. Only the single-browser highlight
  comparison above was made.
- **Light theme**: W6-CDX-43. **Editor edit mode** at phone widths: the editor redirects phones to the archive view.
- **Notifications pill with a count**: the seeded account has no unread items; the unit tests cover 3, 150 and 0.
- **The first-visit state of the document's toolbar**: one "after" capture shows the H1 button active from the caret's
  position at settle. The probe does not move the caret; the before capture was taken with the caret elsewhere.
