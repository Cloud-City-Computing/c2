# W6-CDX-43 light theme: captures and gamut, 2026-10-12

- `shots/`: 48 captures, both widths (1280x860, 390x844) and both themes, from a local stack
  (suite-off instance for everything but Account; suite-on instance for Account). The theme is set on
  `data-theme` by `capture.mjs` (the switch lands in W6-CDX-44). Accent captures use `nova` and `cyan`.
- `capture.mjs`: the capture script. Configuration comes from environment variables only.
- `gamut.mjs` and `gamut.json`: the sRGB gamut check of the contract steps (the spec's open item).

Notes from the captures:
- `/editor/:id` at 390 renders Home: the standalone editor is guarded to desktop widths (`MobileEditorGuard`),
  so there is no phone edit capture. The phone document capture is the read view.
- The read-only document's inline code is a danger-bright red in light and a coral-pink in dark (was coral in dark).
- Admin's tab row wraps at 390 (the phone layout, not a colour change).
