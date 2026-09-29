// Comment masking, offsets and lines.
// A line comment is masked: #111111 and oklch(0.5 0.1 240) are not findings.
/* A block comment is masked too: #222222,
   and across lines: rgb(1 2 3). */
const glyph = '𝒜'; /* an astral character sits before this comment: #333333 */
const after = '#444444';
const url = 'https://github.com/Cloud-City-Computing/cloud-city-design'; const next = '#555555';
const escaped = 'it\'s #666666';
export { glyph, after, url, next, escaped };
