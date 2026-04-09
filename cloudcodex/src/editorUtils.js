/**
 * Shared utility functions for Editor read-only rendering.
 * Extracted for testability — used by ReadOnlyContent in Editor.jsx.
 */

/** Escape HTML special characters */
export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert a lowlight hast node to an HTML string */
export function hastNodeToHtml(node) {
  if (node.type === 'text') return escapeHtml(node.value || '');
  if (node.type === 'element') {
    const tag = node.tagName || 'span';
    const cls = node.properties?.className?.join(' ') || '';
    const open = cls ? `<${tag} class="${cls}">` : `<${tag}>`;
    const children = (node.children || []).map(hastNodeToHtml).join('');
    return `${open}${children}</${tag}>`;
  }
  return '';
}

/** Convert a lowlight hast tree (root node) to an HTML string */
export function hastToHtml(tree) {
  if (!tree || !tree.children) return '';
  return tree.children.map(hastNodeToHtml).join('');
}

/**
 * Encode a string to base64 (safe for Unicode).
 * Used to store draw.io XML/SVG in HTML data attributes.
 */
export function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Decode a base64 string back to Unicode text.
 */
export function decodeBase64(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * Extract raw SVG from a diagrams.net export data URI.
 * diagrams.net returns SVG as `data:image/svg+xml;base64,...`
 * This function extracts and decodes the actual SVG markup.
 * Returns the input unchanged if it's not a data URI.
 */
export function extractSvgFromDataUri(data) {
  if (!data) return '';
  if (data.startsWith('data:')) {
    const b64Match = data.match(/;base64,(.+)/);
    if (b64Match) {
      try { return decodeBase64(b64Match[1]); } catch { /* fall through */ }
    }
  }
  return data;
}
