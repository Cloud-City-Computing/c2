# W6-CDX-39: controls, the Toast and dialog panels (dark theme)

Captured 2026-10-11 against a throwaway Codex (`NODE_ENV=development`, seeded with `seed.sql`, MySQL 8.4 in a
container on a private network, the app published on 127.0.0.1 only). Headless Chrome over CDP;
`raw/capture-script.mjs` produced every PNG, and every PNG was opened and read after capture.

- `before/`: the code at `77b5ac5` (A1's merge, before any W6-CDX-39 change).
- `after/`: this branch, the same routes, the same seeded data, the same script.
- `raw/edit-mode-probe.mjs` and `raw/geometry-{before,after}.json`: the deferred editor's edit-mode geometry.
- Sizes: 1280x860 and 390x844, dark. Light is W6-CDX-43.

## What changed on screen

- **Toast (X2, X10, placement).** `toast-after-copy`: the first toast after a fresh load. Before, nothing appears
  (the X2 drop reproduced); after, the toast shows bottom right, its message in the primary text, the status on
  the icon and the edge. At 390 the toast is full width and sits over the bottom tab bar, which PR 3 removes.
- **Squad and role menus.** `invite-squad-menu`: the native select (light chrome) becomes a menu trigger with a
  chevron; the open menu lists the squads with the current choice marked. The label is the uppercase field label.
  `explore-sort-open`: the Explore sort is a menu. The before build cannot open a native select in a capture, so
  its "open" shot is the closed select.
- **Buttons.** `buttons-archive`: 30 px buttons on `--radius-md`, 13 px at weight 500, no letter-spacing; the
  danger Delete keeps its fill and the dark ink. Small buttons keep 26 px.
- **Tabs.** `activity-tabs`, `notifications-tabs`: a 24 px gap, the active tab in the primary text with a 2 px
  accent underline (before: accent text).
- **Dialog panels and chips.** `confirm-delete-dialog`, `admin-users-chips`: the panel has a strong hairline and
  `--radius-lg`; the role chips are pills at 12 px.

## Geometry of the deferred editor

`raw/edit-mode-probe.mjs`, the document in edit mode at 1280. The container, the editor, the toolbar, the title and
the header are at identical boxes before and after. The 30 toolbar buttons and the textarea and comment-button
boxes match too. One toolbar button's class string differs in its truncated suffix (the probe cuts at 30 characters),
with its box identical; not investigated further.

## Not verified here

- The two-cursor smoke with a comment (needs two signed-in browsers).
- Avatar placeholders on screen: Activity and Notifications were empty in the seeded instance, so the avatar tints
  are covered by unit tests and the colour gate only.
- The icon button with a 44 px hit area: no icon-button class exists in Codex yet; it lands with the first control
  that needs one.
- The destructive-copy audit is not complete: most confirmations already name the loss; the squad-member removal
  and the repo removal copy still do not.
