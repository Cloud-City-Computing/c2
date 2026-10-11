# W6-CDX-23: focus, buttons and the Toast, visual check

Captured 2026-10-11 with `iris shoot` against a throwaway Vite harness that loads the real
`vendor/cloud-city-design/core.css`, `fonts.css`, `src/codex.css`, `src/index.css` and
`src/components/Toast.jsx` (the harness is not committed). Both captures are dark theme, the
only theme Codex ships through Wave 6.

- `cdx23-buttons-toast.png`: the buttons at rest (a solid accent primary with its dark label,
  a ghost, a danger, a small primary), the search input and document list, and three toasts
  (success, error, info), each with its dismiss button.
- `cdx23-focus-ring.png`: the same page with the primary "Save" button focused
  programmatically; the one global `:focus-visible` ring (`--cx-focus-ring`, 2px, offset 2px)
  is visible against the page surface.

What the captures show, read by eye: the rest-state primary has no glow or lift; the ring is
visible on the page surface; each toast's status shows in its edge and text on the shared
panel surface; the dismiss × is present in every toast.

Raw iris output for both shots: every verdict `pass` with `console clean` and `network-clean`.
A `pass` means the page rendered and nothing threw; the reading above is the check.

## Review round (momus findings, same branch)

A render harness (throwaway, deleted) loaded the real `vendor/cloud-city-design` CSS,
`src/codex.css` and `src/index.css`, with each clipping container and a flush control on the
page. `*-before.png` puts back the pre-fix `outline-offset: 2px` on the clipping containers
(the `before` flag in the harness); `*-after.png` is the shipped CSS. Focus was set
programmatically on the named control, which makes it `:focus-visible`.

- `review-editor-before.png` and `review-editor-after.png`: the focused `.tiptap` inside
  `.editor-container`. Before, only its top and bottom edges show; after, the full ring is inside
  the editor edge.
- `review-markdown-after.png`: the focused textarea in `.markdown-editor__textarea-wrapper`, a
  full ring inside the edge.
- `review-sidebar-before.png` and `review-sidebar-after.png`: a flush `.sidebar` item. Before,
  the sides are clipped; after, the full ring shows.
- `review-sync-after.png`: a flush `.gh-sync-menu` item, full ring.
- `review-browser-after.png`: a flush `.gh-browser__sidebar` control, full ring.
- `review-modal-after.png`: a flush Close control in `.gh-modal`, full ring. The page scrolled to
  it; the verdict was `unverifiable:hover` from iris, and the image was read by eye.
- `review-field-after.png`: a text field focused, one ring against its own border (no second halo).

Not captured: the toast's keyboard focus with its timers held, and the pressed button state
(a mouse press cannot be held in a static capture). Both are proved in `Toast.test.jsx` (fake
timers) and `painted.test.js`.
