/**
 * Cloud Codex - the rich-text highlights follow a reflow at once (W6-CDX-41, momus round 1)
 *
 * The highlights were recomputed on comment changes and every 2 s. A reflow of the editor or its container (a width or
 * height change with no comment change) must recompute them when it happens, through a ResizeObserver on both elements.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { RichTextHighlights } from '../../../src/components/CommentHighlights.jsx';

class FakeResizeObserver {
  static instances = [];
  constructor(callback) { this.callback = callback; this.observed = []; FakeResizeObserver.instances.push(this); }
  observe(el) { this.observed.push(el); }
  unobserve() {}
  disconnect() { this.observed = []; }
}

describe('RichTextHighlights and reflow', () => {
  let rects;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    rects = [{ top: 10, left: 20, width: 50, height: 14 }];
    Range.prototype.getClientRects = vi.fn(() => rects);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete Range.prototype.getClientRects;
  });

  it('recomputes when the editor resizes, without waiting for the 2 s interval', () => {
    const container = document.createElement('div');
    const editorEl = document.createElement('div');
    editorEl.textContent = 'hello world';
    container.appendChild(editorEl);
    document.body.appendChild(container);
    container.getBoundingClientRect = () => ({ top: 0, left: 0, width: 800, height: 600 });

    const editorRef = { current: { view: { dom: editorEl } } };
    const containerRef = { current: container };
    const comments = [{ id: 1, selected_text: 'hello', tag: 'comment', status: 'open' }];

    const { container: out } = render(
      <RichTextHighlights editorRef={editorRef} comments={comments} activeCommentId={null} containerRef={containerRef} />,
    );
    const rect = () => out.querySelector('.comment-highlight-rect');
    expect(rect().style.top).toBe('10px');

    const observer = FakeResizeObserver.instances[0];
    expect(observer.observed).toEqual(expect.arrayContaining([editorEl, container]));

    // The editor reflows: the text moves down 30 px and the observer fires. No timer runs.
    rects = [{ top: 40, left: 20, width: 50, height: 14 }];
    Range.prototype.getClientRects = vi.fn(() => rects);
    act(() => { observer.callback([]); });
    expect(rect().style.top).toBe('40px');
  });
});
