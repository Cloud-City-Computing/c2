# Suite theme switch: captures and first paint (W6-CDX-44)

Run on 2026-10-12 against a production build (`NODE_ENV=production`) of track/w6-cdx-44-theme-contract, on a
throwaway MySQL 8.4 container on a private Docker network (no host port), signed in as the boot admin.

- `capture.mjs` takes every shot here. Its inputs are environment variables only (`BASE_URL`, `CDX_USER`,
  `CDX_PASSWORD`, `PW_MODULE`, `CHROME_PATH`); `results.json` is its log.
- `shots/` holds 24 PNGs at 1280 x 860 and 390 x 844: the header toggle at rest and on hover, before and after a
  switch, from a stored light and a stored dark choice; the Appearance panel with Light, Dark, Match system (with the
  OS emulated light), and the Nova accent in both themes.
- The toggle is a direct switch (the plan's design), so it has no open state. Match system is in Appearance.
- First paint: `first-paint-stored-light-dark-os-normal.png` and `...-throttled.png` hold the main bundle until the
  page is parsed (the throttled run at 6x CPU). The stored choice is light and the OS is dark; both frames are light.
  The page is blank at that point because React has not mounted, which is the intent of the check.
- Console check: no Content Security Policy violation in any run (`results.json`, `problems` arrays).
- Not verified here: the round trip to Cloud Command on a shared parent domain (the sibling was not run).
