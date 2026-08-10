/**
 * Cloud Codex — Tests for src/components/editor/ReadOnlyContent.jsx
 *
 * Extracted from Editor.jsx by E2. This renders saved document HTML with
 * dangerouslySetInnerHTML, so the sanitizing it does is load-bearing.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ReadOnlyContent from '../../../src/components/editor/ReadOnlyContent.jsx';
import { encodeBase64 } from '../../../src/editorUtils.js';

const html = (ui) => render(ui).container.querySelector('.document-readonly');

describe('ReadOnlyContent', () => {
  it('renders nothing for empty content', () => {
    expect(html(<ReadOnlyContent html="" />).innerHTML).toBe('');
    expect(html(<ReadOnlyContent html={null} />).innerHTML).toBe('');
  });

  it('renders ordinary markup through', () => {
    const el = html(<ReadOnlyContent html="<h2>Title</h2><p>Body</p>" />);
    expect(el.querySelector('h2').textContent).toBe('Title');
    expect(el.querySelector('p').textContent).toBe('Body');
  });

  it('strips scripts from the content it injects', () => {
    const el = html(<ReadOnlyContent html={'<p>ok</p><script>alert(1)</script>'} />);
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('ok');
  });

  it('strips inline event handlers', () => {
    const el = html(<ReadOnlyContent html={'<img src="x" onerror="alert(1)">'} />);
    expect(el.innerHTML).not.toContain('onerror');
  });

  it('highlights a code block and tags it with the language', () => {
    const el = html(
      <ReadOnlyContent html={'<pre><code class="language-javascript">const a = 1;</code></pre>'} />
    );
    const code = el.querySelector('pre code');
    expect(code.classList.contains('hljs')).toBe(true);
    // lowlight wraps tokens in spans rather than leaving bare text
    expect(code.innerHTML).toContain('<span');
    expect(el.querySelector('.code-lang-badge').textContent).toBe('javascript');
  });

  it('leaves an unknown language unhighlighted rather than throwing', () => {
    const el = html(
      <ReadOnlyContent html={'<pre><code class="language-notareallanguage">x</code></pre>'} />
    );
    expect(el.querySelector('pre code')).not.toBeNull();
    expect(el.textContent).toContain('x');
  });

  it('inlines a legacy base64 draw.io diagram', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>';
    const el = html(
      <ReadOnlyContent html={`<div data-drawio-svg="${encodeBase64(svg)}"></div>`} />
    );
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('circle')).not.toBeNull();
  });

  it('survives an undecodable draw.io payload', () => {
    const el = html(<ReadOnlyContent html={'<div data-drawio-svg="!!!not base64!!!"></div>'} />);
    expect(el).not.toBeNull();
  });
});
