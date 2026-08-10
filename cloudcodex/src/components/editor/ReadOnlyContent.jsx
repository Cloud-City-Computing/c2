/**
 * Cloud Codex - Read-only document renderer
 *
 * Renders saved document HTML outside the editor: syntax-highlights code
 * blocks with lowlight and inlines draw.io diagrams. Everything it emits has
 * been through sanitizeHtml first, which is why the dangerouslySetInnerHTML
 * here is safe.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { createLowlight, common } from 'lowlight';
import { hastToHtml, decodeBase64, sanitizeHtml } from '../../editorUtils';

const readonlyLowlight = createLowlight(common);

export default function ReadOnlyContent({ html }) {
  const processedHtml = useMemo(() => {
    if (!html) return '';
    const sanitized = sanitizeHtml(html);
    // Parse into a DOM so we can process code blocks and diagrams
    const parser = new DOMParser();
    const doc = parser.parseFromString('<div>' + sanitized + '</div>', 'text/html');
    const container = doc.body.firstChild;

    // Highlight code blocks with lowlight
    const codeBlocks = container.querySelectorAll('pre code');
    for (const codeEl of codeBlocks) {
      const pre = codeEl.parentElement;
      const langClass = [...codeEl.classList].find(c => c.startsWith('language-'));
      const lang = langClass ? langClass.replace('language-', '') : '';
      const text = codeEl.textContent || '';
      try {
        const result = lang && lang !== 'plaintext'
          ? readonlyLowlight.highlight(lang, text)
          : readonlyLowlight.highlightAuto(text);
        codeEl.innerHTML = hastToHtml(result);
        codeEl.classList.add('hljs');
        const detectedLang = lang || result.data?.language || '';
        if (detectedLang && pre) {
          const badge = doc.createElement('span');
          badge.className = 'code-lang-badge';
          badge.textContent = detectedLang;
          pre.appendChild(badge);
        }
      } catch { /* leave unhighlighted */ }
    }

    // Process draw.io diagram blocks — handle both legacy (base64 data attr)
    // and current (inline SVG) formats
    const drawioBlocks = container.querySelectorAll('div[data-type="drawioBlock"], div[data-drawio-svg]');
    for (const div of drawioBlocks) {
      // Legacy format: decode base64 from data-drawio-svg attribute
      const b64 = div.getAttribute('data-drawio-svg');
      if (b64) {
        try {
          const svgStr = decodeBase64(b64);
          const clean = DOMPurify.sanitize(svgStr, { USE_PROFILES: { svg: true, svgFilters: true } });
          div.innerHTML = clean;
        } catch { /* leave empty */ }
      }
      // Current format: SVG is already inline, just ensure it's sanitized
      // (sanitizeHtml at the top of this function already handled it)
    }

    return container.innerHTML;
  }, [html]);

  return (
    <div
      className="document-readonly"
      dangerouslySetInnerHTML={{ __html: processedHtml }}
    />
  );
}
