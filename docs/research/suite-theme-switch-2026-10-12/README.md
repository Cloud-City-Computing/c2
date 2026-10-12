# Suite theme switch: captures and first paint (W6-CDX-44)

Captured 2026-10-12 against a production build (`NODE_ENV=production`) of `track/w6-cdx-44-theme-contract`, on a
throwaway MySQL 8.4 container on a private Docker network (no host port), signed in as the boot admin with the
seeded "Getting Started" archive and its one document.

- `capture.mjs` takes every shot here. Its inputs are environment variables only (`BASE_URL`, `CDX_USER`,
  `CDX_PASSWORD`, `CDX_ARCHIVE`, `CDX_LOG`, `PW_MODULE`, `CHROME_PATH`). `results.json` is its log: the route,
  theme, width, final URL and console problems of every shot (no credentials, no machine paths).
- Polish round (the Default pill, the segment focus ring, the phone-strip focus):
  - Popover open at 1280, 390 and 320 in both themes: `popover-open-*.png`. Default is a compact outlined pill; its
    selected state is a ring.
  - Keyboard focus at 1280 and 390 in both themes: `keyboard-focus-*.png`. Focus on a segment is shown in
    `segment-focus-{light,dark}-*.png` (1x crops, taken at 3x device scale); `segment-focus-dark-Dark-3x.png` is the
    dark Dark segment at 3x, where its ring is readable.
  - Phone strip with the Notifications item focused: `strip-focus-bell-{light,dark}-new-390.png`.
  - `strip-focus-check.mjs` (run in a browser, since jsdom has no layout) Tabs through every strip item at 390 px in
    both themes and checks each item's ring (the item grown by 4 px) lies inside the strip. Result: 10 focused items,
    0 outside, `strip-focus-check.json`. `strip-focus-check-control-old.json` is the same check on the previous strip
    CSS (no inline padding, no trailing room, no reveal): 10 of 10 outside. The reveal itself is `src/lib/strip-focus.js`.
- `shots/` holds 70 PNGs, every one of them looked at:
  - Routes, light and dark, at 1280 x 860 and 390 x 844: home, archives, archive view, document read, document edit,
    Account, Admin, Notifications, Activity, Workspaces (non-suite), not found. Plus the signed-out front door.
  - The Appearance popover open at 1280, 390 and 320, in both themes; the keyboard-focus capture at 1280 in both
    themes (the checked option takes focus on open; one Tab moves to the next control inside the panel).
  - First paint, with the stylesheet applied and the React bundle held (a held stylesheet paints nothing, so it
    cannot be measured): `first-paint-stored-light-os-dark-normal.png` and `...-throttled.png` (6x CPU) for a stored
    light choice with the OS dark. `results.json` records the html computed background and the canvas pixel:
    `oklch(0.985 0.002 230)` and rgb(249,250,251), both light. The control,
    `first-paint-control-no-script-stored-light-os-dark.png`, serves the same HTML with the boot script removed:
    `oklch(0.17 0.012 240)` and rgb(11,16,20), dark. So the check can see the flash it guards against.
- Known gaps, by design or by existing layout:
  - Document edit at 390 px redirects to Home: the mobile editor guard (`MobileEditorGuard`) refuses the editor on a
    phone, so there is no 390 edit state to capture.
  - Not Found and the signed-out front door have no page header, so they have no Appearance control.
  - Fixed in the polish round: the phone-strip focus ring was clipped at the strip's edge (see the strip check above).
- Not verified here: the round trip to Cloud Command on a shared parent domain (the sibling was not run).
