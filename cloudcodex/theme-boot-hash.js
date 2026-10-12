/**
 * The Content-Security-Policy hash of the pre-paint theme script in index.html (W6-CDX-44)
 *
 * The script is inline, so script-src allows it by SHA-256, never by 'unsafe-inline'. If you edit the
 * script, recompute this value: tests/theme-boot-hash.test.js fails with the new one and names the
 * three places that must agree (index.html, this file, and the built dist/index.html).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

export const THEME_BOOT_HASH = "'sha256-6JYFxiXiFjILuFU6VNGUJCvIqHs/SDy8BEOL8poNya0='";
