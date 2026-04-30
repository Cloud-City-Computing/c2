import { describe, it, expect } from 'vitest';
import { extractMentions, diffMentions, extractContextSnippet } from '../../routes/helpers/mentions.js';

describe('routes/helpers/mentions', () => {
  describe('extractMentions', () => {
    it('returns empty set for empty/null input', () => {
      expect(extractMentions(null).size).toBe(0);
      expect(extractMentions('').size).toBe(0);
      expect(extractMentions('plain text with no mentions').size).toBe(0);
    });

    it('parses a single mention', () => {
      const html = '<p>Hi <span data-mention-user-id="42" data-mention-username="alice">@alice</span></p>';
      const ids = extractMentions(html);
      expect(ids.size).toBe(1);
      expect(ids.has(42)).toBe(true);
    });

    it('returns unique ids when the same user is mentioned twice', () => {
      const html = '<p><span data-mention-user-id="42">@a</span> and <span data-mention-user-id="42">@a</span></p>';
      const ids = extractMentions(html);
      expect(ids.size).toBe(1);
      expect(ids.has(42)).toBe(true);
    });

    it('captures multiple distinct mentions', () => {
      const html = '<span data-mention-user-id="1">@a</span><span data-mention-user-id="7">@b</span>';
      const ids = extractMentions(html);
      expect(ids.size).toBe(2);
      expect(ids.has(1)).toBe(true);
      expect(ids.has(7)).toBe(true);
    });

    it('IGNORES mentions inside code blocks', () => {
      const html = '<pre><code>like <span data-mention-user-id="99">@x</span></code></pre>';
      expect(extractMentions(html).size).toBe(0);
    });

    it('IGNORES mentions inside inline <code>', () => {
      const html = '<p>see <code><span data-mention-user-id="99">@x</span></code></p>';
      expect(extractMentions(html).size).toBe(0);
    });

    it('IGNORES <script> and <style> bodies', () => {
      const html = '<style>data-mention-user-id="1"</style><script>data-mention-user-id="2"</script>';
      expect(extractMentions(html).size).toBe(0);
    });

    it('skips invalid ids', () => {
      const html = '<span data-mention-user-id="0">@x</span><span data-mention-user-id="-3">@y</span>';
      expect(extractMentions(html).size).toBe(0);
    });
  });

  describe('diffMentions', () => {
    it('returns the set of newly added recipients', () => {
      const before = '<span data-mention-user-id="1">@a</span>';
      const after = '<span data-mention-user-id="1">@a</span><span data-mention-user-id="2">@b</span>';
      const added = diffMentions(before, after);
      expect(added.size).toBe(1);
      expect(added.has(2)).toBe(true);
    });

    it('returns empty set when no new mentions were added', () => {
      const html = '<span data-mention-user-id="1">@a</span>';
      expect(diffMentions(html, html).size).toBe(0);
    });

    it('treats null/empty prev as no prior mentions', () => {
      const after = '<span data-mention-user-id="42">@a</span>';
      expect(diffMentions(null, after).has(42)).toBe(true);
      expect(diffMentions('', after).has(42)).toBe(true);
    });

    it('does NOT consider deleted mentions', () => {
      const before = '<span data-mention-user-id="1">@a</span><span data-mention-user-id="2">@b</span>';
      const after = '<span data-mention-user-id="1">@a</span>';
      expect(diffMentions(before, after).size).toBe(0);
    });
  });

  describe('extractContextSnippet', () => {
    it('returns null for empty input', () => {
      expect(extractContextSnippet('', 1)).toBeNull();
    });

    it('returns text around the mention', () => {
      const html = '<p>Hey <span data-mention-user-id="42" data-mention-username="alice">@alice</span> please review this section.</p>';
      const snippet = extractContextSnippet(html, 42);
      expect(snippet).toContain('@alice');
      expect(snippet.toLowerCase()).toContain('please review');
    });

    it('falls back to plain text when mention text is not in body', () => {
      const html = '<p>Some content</p>';
      const snippet = extractContextSnippet(html, 99);
      expect(snippet).toContain('Some content');
    });
  });
});
