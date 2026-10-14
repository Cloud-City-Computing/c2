/**
 * Cloud Codex - the product mark (W6-CDX-40, K10): the page glyph on the accent tile
 *
 * An outlined document page in --cx-on-accent on a 24 px --cx-accent-fill tile (the svg's own background). It replaces the cloud logo image in
 * the sidebar and on the signed-out screen. Drawn in CSS-classed SVG
 * (no image), so the tile and the glyph take their colour from the tokens in every theme.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

export default function ProductMark({ className = '', size = 24 }) {
  return (
    <svg
      className={`product-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="product-mark__glyph"
        d="M7 4.5h7.5L18 8v11.5H7z M14.5 4.5V8H18 M9.5 12h5 M9.5 15h5"
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
