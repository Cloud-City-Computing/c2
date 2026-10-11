# W6-CDX-24: dialogs with real semantics, visual check

Captured 2026-10-11 with `iris shoot` against a throwaway Vite harness that loads the real
`vendor/cloud-city-design/core.css`, `fonts.css`, `src/codex.css` and `src/index.css`, then mounts
the real `showModal`, `ConfirmDialog` and `NewLogModal` (and the real `DeleteFileModal`, for the
GitHub capture). The harness is not committed. Every capture is dark theme, the only theme Codex
ships through Wave 6, at 1280 by 800.

`before/` is the same harness on the W6-CDX-23 head (`47d9471`), the state this PR stacks on.
`after/` is this branch. No `before` exists for the GitHub delete-file dialog: that component was
not exported before this PR, so the harness could not mount it.

- `confirm-delete`: the scrim and the dialog. Before, the page behind is blurred and no control has
  focus. After, the page is a flat scrim (the blur is gone), and focus lands on Cancel, the first
  control that is not the close button, with the one global focus ring fully visible. The × is
  unchanged in position and look (it is now a button).
- `new-log`: the form dialog. After, the title field holds focus with its ring, not clipped by the
  dialog's edge. Before, nothing had focus.
- `github-delete-file`: an in-page dialog (portalled to `document.body`, so the inert app root does
  not freeze it). Focus lands in the commit message field, the first real control; the field's ring
  sits inside the dialog's clip.

What the captures show, read by eye: the scrim is flat and no longer blurs the page; each dialog
starts on a sensible control; no close control or focus ring is clipped; the close × is the same
glyph in the same place. The iris verdict for every capture is `pass` with the console clean, which
means the page rendered and nothing threw. The reading above is the check.

Not captured: the archive-access modal (`ManageArchiveAccessModal`). It needs a live archive and its
access list to render, which the harness does not provide.
