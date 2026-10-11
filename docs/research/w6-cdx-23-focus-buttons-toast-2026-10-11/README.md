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
