/**
 * Cloud Codex — Tests for services/email-templates.js
 *
 * Pure-function tests for the notification email builders. No mocks
 * required — the templates only depend on APP_URL and pure string ops.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { buildNotificationEmail } from '../../services/email-templates.js';
import { APP_URL } from '../../routes/helpers/shared.js';

const baseData = {
  recipientName: 'Alice',
  actorName: 'Bob',
  docTitle: 'My Doc',
  snippet: 'Hello world',
  linkUrl: '/d/123',
};

describe('email-templates / buildNotificationEmail', () => {
  it('returns null for an unknown notification type', () => {
    expect(buildNotificationEmail('unknown_type', baseData)).toBeNull();
  });

  it('returns subject/text/html for a mention', () => {
    const out = buildNotificationEmail('mention', baseData);
    expect(out).toMatchObject({
      subject: expect.stringContaining('Bob mentioned you'),
      text: expect.any(String),
      html: expect.any(String),
    });
    expect(out.subject).toContain('My Doc');
  });

  it('escapes HTML-special characters in user input', () => {
    const out = buildNotificationEmail('mention', {
      ...baseData,
      actorName: '<script>alert(1)</script>',
      docTitle: 'A "quote" & ampersand',
      snippet: '<img src=x onerror=alert(1)>',
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).toContain('&amp;');
    expect(out.html).toContain('&quot;');
  });

  it('absolute URL: leaves http(s) URLs unchanged', () => {
    const out = buildNotificationEmail('mention', {
      ...baseData,
      linkUrl: 'https://other.example.com/x',
    });
    expect(out.html).toContain('href="https://other.example.com/x"');
    expect(out.text).toContain('https://other.example.com/x');
  });

  it('absolute URL: prefixes APP_URL onto site-relative paths', () => {
    const out = buildNotificationEmail('mention', { ...baseData, linkUrl: '/d/123' });
    expect(out.html).toContain(`href="${APP_URL}/d/123"`);
  });

  it('absolute URL: handles URLs without leading slash', () => {
    const out = buildNotificationEmail('mention', { ...baseData, linkUrl: 'd/123' });
    expect(out.html).toContain(`${APP_URL.replace(/\/$/, '')}/d/123`);
  });

  it('absolute URL: falls back to APP_URL when linkUrl is empty', () => {
    const out = buildNotificationEmail('mention', { ...baseData, linkUrl: '' });
    expect(out.html).toContain(`href="${APP_URL}"`);
  });

  it('omits the snippet block when snippet is null/empty', () => {
    const out = buildNotificationEmail('mention', { ...baseData, snippet: '' });
    expect(out.html).not.toContain('<blockquote');
  });

  it('emits a "Manage notifications" footer link to the prefs page', () => {
    const out = buildNotificationEmail('mention', baseData);
    expect(out.html).toContain('/notifications/preferences');
    expect(out.text).toContain('Manage notifications');
  });

  // ── per-type subject + intro spot-checks ───────────────

  it('comment_on_my_doc has the right subject and CTA', () => {
    const out = buildNotificationEmail('comment_on_my_doc', baseData);
    expect(out.subject).toContain('Bob commented on');
    expect(out.html).toContain('View comment');
  });

  it('watched_log_update has no snippet block', () => {
    const out = buildNotificationEmail('watched_log_update', baseData);
    expect(out.subject).toContain('Bob edited');
    expect(out.html).not.toContain('<blockquote');
  });

  it('watched_publish announces a new version', () => {
    const out = buildNotificationEmail('watched_publish', baseData);
    expect(out.subject).toContain('Bob published');
    expect(out.html).toMatch(/new version/i);
  });

  it('watched_comment includes the snippet', () => {
    const out = buildNotificationEmail('watched_comment', baseData);
    expect(out.subject).toContain('Bob commented on');
    expect(out.html).toContain('Hello world');
  });
});
