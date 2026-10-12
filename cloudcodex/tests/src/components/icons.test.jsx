/**
 * Cloud Codex - the stroke icon set (W6-CDX-39, Task 2.4): one set, 14 to 15 px, drawn with currentColor,
 * decorative (aria-hidden). No icon is an emoji.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as icons from '../../../src/components/icons.jsx';

const NAMES = ['ChevronDownIcon', 'CheckIcon', 'XIcon', 'InfoIcon'];

describe('the stroke icon set', () => {
  it.each(NAMES)('%s is a 15 px stroke svg in currentColor, hidden from assistive tech', (name) => {
    const Icon = icons[name];
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg');
    expect(svg, `${name} renders an svg`).not.toBeNull();
    expect(svg.getAttribute('width')).toBe('15');
    expect(svg.getAttribute('height')).toBe('15');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws no emoji: every icon is an svg with no text content', () => {
    for (const name of NAMES) {
      const { container, unmount } = render(icons[name]());
      expect(container.textContent).toBe('');
      unmount();
    }
  });
});
