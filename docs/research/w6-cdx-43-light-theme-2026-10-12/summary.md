# W6-CDX-43 light theme: captures and gamut, 2026-10-12

- `shots/`: 50 captures (the phone document edit is skipped, see below), both widths (1280x860, 390x844) and both themes, from a local stack
  (suite-off instance for everything but Account; suite-on instance for Account). The theme is set on
  `data-theme` by `capture.mjs` (the switch lands in W6-CDX-44). Accent captures use `nova` and `cyan`.
- `capture.mjs`: the capture script. Configuration comes from environment variables only.
- `gamut.mjs` and `gamut.json`: the sRGB gamut check of the contract steps (the spec's open item).

Notes from the captures:
- `/editor/:id` at 390 renders Home: the standalone editor is guarded to desktop widths (`MobileEditorGuard`),
  so there is no phone edit capture. The phone document capture is the read view.
- The read-only document's inline code is a danger-bright red in light and a coral-pink in dark (was coral in dark).
- Admin's tab row wraps at 390 (the phone layout, not a colour change).

Review round (2026-10-12, items 1 to 8):
- `dark-before/`: the original tree's dark state of the GitHub history page, the read-only document and the editor,
  captured from a temporary checkout at the base commit. Compared pixel for pixel against `shots/`: the GitHub history
  page differs by one RGB unit at most (rounding); the read-only document differs only in the inline code colour;
  the editor differs only in the presence avatar's initial (white to ink, the label avatarLabel() chooses).
- The GitHub history page is captured with the GitHub API answered by fixtures in `capture.mjs` (no network, no
  token). The file tree shows "Loading..." because the tree fixture is minimal; the commit history is the real view.
- Not captured: a document with two cursors (needs a second signed-in browser and a comment); the presence labels are
  covered by `presence-label.test.js` instead.
