/**
 * Email templates for Cloud Codex notifications
 *
 * Each builder returns { subject, text, html } for a notification type.
 * Used by services/notifications.js when sending an email alert.
 *
 * The two account-security emails an email change sends are built here too
 * (buildEmailChangeCodeEmail, buildEmailChangedNoticeEmail). They are not
 * notifications, so they skip the notification-preferences footer.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { APP_URL } from '../routes/helpers/shared.js';

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteUrl(linkUrl) {
  if (!linkUrl) return APP_URL;
  if (/^https?:\/\//i.test(linkUrl)) return linkUrl;
  return `${APP_URL.replace(/\/$/, '')}${linkUrl.startsWith('/') ? '' : '/'}${linkUrl}`;
}

function renderShell({ heading, intro, snippet, ctaLabel, ctaUrl, settingsUrl }) {
  const text = [
    heading,
    '',
    intro,
    snippet ? `\n${snippet}\n` : '',
    `${ctaLabel}: ${ctaUrl}`,
    '',
    `Manage notifications: ${settingsUrl}`,
  ].filter(Boolean).join('\n');

  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
    ${snippet ? `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #ccc;color:#555;background:#f7f7f7;">${escapeHtml(snippet)}</blockquote>` : ''}
    <p style="margin:24px 0;">
      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:10px 20px;background:#2ca7db;color:#fff;text-decoration:none;border-radius:4px;">${escapeHtml(ctaLabel)}</a>
    </p>
    <p style="margin:32px 0 0;font-size:12px;color:#888;">
      <a href="${escapeHtml(settingsUrl)}" style="color:#888;">Manage notifications</a>
    </p>
  </div>
</body></html>`;

  return { text, html };
}

const builders = {
  mention({ recipientName, actorName, docTitle, snippet, linkUrl }) {
    const ctaUrl = absoluteUrl(linkUrl);
    const settingsUrl = absoluteUrl('/notifications/preferences');
    return {
      subject: `[Cloud Codex] ${actorName} mentioned you in “${docTitle}”`,
      ...renderShell({
        heading: `${actorName} mentioned you in “${docTitle}”`,
        intro: `Hi ${recipientName}, ${actorName} mentioned you in a document:`,
        snippet,
        ctaLabel: 'View document',
        ctaUrl,
        settingsUrl,
      }),
    };
  },

  comment_on_my_doc({ recipientName, actorName, docTitle, snippet, linkUrl }) {
    const ctaUrl = absoluteUrl(linkUrl);
    const settingsUrl = absoluteUrl('/notifications/preferences');
    return {
      subject: `[Cloud Codex] ${actorName} commented on “${docTitle}”`,
      ...renderShell({
        heading: `${actorName} commented on your document`,
        intro: `Hi ${recipientName}, ${actorName} left a comment on “${docTitle}”:`,
        snippet,
        ctaLabel: 'View comment',
        ctaUrl,
        settingsUrl,
      }),
    };
  },

  watched_log_update({ recipientName, actorName, docTitle, linkUrl }) {
    const ctaUrl = absoluteUrl(linkUrl);
    const settingsUrl = absoluteUrl('/notifications/preferences');
    return {
      subject: `[Cloud Codex] ${actorName} edited “${docTitle}”`,
      ...renderShell({
        heading: `Update on a doc you’re watching`,
        intro: `Hi ${recipientName}, ${actorName} edited “${docTitle}”.`,
        snippet: null,
        ctaLabel: 'View document',
        ctaUrl,
        settingsUrl,
      }),
    };
  },

  watched_publish({ recipientName, actorName, docTitle, linkUrl }) {
    const ctaUrl = absoluteUrl(linkUrl);
    const settingsUrl = absoluteUrl('/notifications/preferences');
    return {
      subject: `[Cloud Codex] ${actorName} published “${docTitle}”`,
      ...renderShell({
        heading: `New version published`,
        intro: `Hi ${recipientName}, ${actorName} published a new version of “${docTitle}”.`,
        snippet: null,
        ctaLabel: 'View document',
        ctaUrl,
        settingsUrl,
      }),
    };
  },

  watched_comment({ recipientName, actorName, docTitle, snippet, linkUrl }) {
    const ctaUrl = absoluteUrl(linkUrl);
    const settingsUrl = absoluteUrl('/notifications/preferences');
    return {
      subject: `[Cloud Codex] ${actorName} commented on “${docTitle}”`,
      ...renderShell({
        heading: `New comment on a doc you’re watching`,
        intro: `Hi ${recipientName}, ${actorName} commented on “${docTitle}”:`,
        snippet,
        ctaLabel: 'View comment',
        ctaUrl,
        settingsUrl,
      }),
    };
  },
};

/**
 * Build subject/text/html for a notification type.
 * Returns null if there is no template (caller should skip email).
 *
 * @param {string} type
 * @param {object} data
 * @returns {{subject: string, text: string, html: string}|null}
 */
export function buildNotificationEmail(type, data) {
  const builder = builders[type];
  if (!builder) return null;
  return builder(data);
}

/**
 * The same shell as the notification emails, without the preferences footer:
 * an account-security email goes out whatever the recipient's notification
 * settings are. `code`, when given, is shown large after the first paragraph.
 */
function renderSecurityShell({ heading, intro, code, outro }) {
  const text = [heading, '', intro, ...(code ? ['', code] : []), '', outro].join('\n');

  const codeHtml = code
    ? `\n    <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#2ca7db;margin:20px 0;">${escapeHtml(code)}</p>`
    : '';
  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>${codeHtml}
    <p style="margin:0 0 16px;color:#555;">${escapeHtml(outro)}</p>
  </div>
</body></html>`;

  return { text, html };
}

/**
 * The confirmation code for an email change on an account with no password.
 * Sent to the account's CURRENT address, so only whoever reads that inbox can
 * move the account to another one.
 *
 * @param {{ recipientName: string, newEmail: string, code: string }} data
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildEmailChangeCodeEmail({ recipientName, newEmail, code }) {
  return {
    subject: 'Cloud Codex: Confirm your new email address',
    ...renderSecurityShell({
      heading: 'Confirm your new email address',
      intro: `Hi ${recipientName}, someone signed in to your Cloud Codex account asked to change its email address to ${newEmail}. Enter this code to confirm:`,
      code,
      outro: 'The code expires in 10 minutes. If you did not ask for this, do not share the code, and tell your administrator: someone else may be signed in to your account.',
    }),
  };
}

/**
 * The notice sent to the OLD address once an account's email has changed, so
 * the owner hears about it even when the change was not theirs.
 *
 * @param {{ recipientName: string, newEmail: string }} data
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildEmailChangedNoticeEmail({ recipientName, newEmail }) {
  return {
    subject: 'Cloud Codex: Your email address was changed',
    ...renderSecurityShell({
      heading: 'Your email address was changed',
      intro: `Hi ${recipientName}, the email address on your Cloud Codex account was changed to ${newEmail}. Every other device signed in to the account has been signed out.`,
      outro: 'If you made this change, there is nothing more to do. If you did not, contact your administrator now: password resets go to the new address from here on.',
    }),
  };
}
