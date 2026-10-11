/**
 * Cloud Codex - The Linked tasks link on a document goes to Cloud Command's page for that document
 *
 * Rendered only in suite mode, for a signed-in page that knows its archive and document ids. The
 * href is the workspace URL from GET /api/suite/links plus /docs/<archiveId>/<logId>, the route
 * Cloud Command's W6-CMD-25 serves. Anything that is not an http(s) URL, or an id that is not a
 * positive integer, renders nothing rather than a dead link.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../src/util.jsx', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../../../src/util.jsx';
import { __resetSuiteCache } from '../../../src/hooks/useSuite.js';
import SuiteDocLink from '../../../src/components/SuiteDocLink.jsx';
import { suiteDocHref } from '../../../src/lib/suite-doc-href.js';

const COMMAND = 'https://command.example.test/w/1';

/** Answers the two suite requests: the public one and the session-only links one. */
function suiteAnswers({ enabled = true, links = { commandWorkspaceUrl: COMMAND }, linksFail = false } = {}) {
  apiFetch.mockImplementation(async (_method, url) => {
    if (url === '/api/suite') return { enabled, name: 'Example Suite' };
    if (linksFail) throw Object.assign(new Error('unauthorized'), { status: 401 });
    return links;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetSuiteCache();
});

describe('suiteDocHref', () => {
  it('builds the Cloud Command document path from the workspace URL and the two ids', () => {
    expect(suiteDocHref(COMMAND, 7, 42)).toBe('https://command.example.test/w/1/docs/7/42');
  });

  it('accepts ids as strings, the way the Editor route supplies the log id', () => {
    expect(suiteDocHref(COMMAND, '7', '42')).toBe('https://command.example.test/w/1/docs/7/42');
  });

  it('drops one trailing slash on the workspace URL so the path is not doubled', () => {
    expect(suiteDocHref(`${COMMAND}/`, 7, 42)).toBe('https://command.example.test/w/1/docs/7/42');
  });

  it('is null when the workspace URL is missing or not an http(s) URL', () => {
    expect(suiteDocHref(null, 7, 42)).toBeNull();
    expect(suiteDocHref('', 7, 42)).toBeNull();
    expect(suiteDocHref('not a url', 7, 42)).toBeNull();
    expect(suiteDocHref('javascript:alert(1)', 7, 42)).toBeNull();
    expect(suiteDocHref('data:text/html,hi', 7, 42)).toBeNull();
  });

  it('accepts ids up to the int4 maximum that Cloud Command accepts, and refuses one above it', () => {
    expect(suiteDocHref(COMMAND, 2147483647, 2147483647)).toBe('https://command.example.test/w/1/docs/2147483647/2147483647');
    expect(suiteDocHref(COMMAND, 2147483648, 42)).toBeNull();
    expect(suiteDocHref(COMMAND, 7, '99999999999')).toBeNull();
  });

  it('is null when an id is missing or not a positive integer, so no path is built from junk', () => {
    expect(suiteDocHref(COMMAND, undefined, 42)).toBeNull();
    expect(suiteDocHref(COMMAND, 7, null)).toBeNull();
    expect(suiteDocHref(COMMAND, 0, 42)).toBeNull();
    expect(suiteDocHref(COMMAND, 'abc', 42)).toBeNull();
    expect(suiteDocHref(COMMAND, '7/../admin', 42)).toBeNull();
    expect(suiteDocHref(COMMAND, 7, '42?x=1')).toBeNull();
  });
});

describe('SuiteDocLink', () => {
  it('renders nothing when suite mode is off, and asks for no links', async () => {
    suiteAnswers({ enabled: false });
    const { container } = render(<SuiteDocLink archiveId={7} logId={42} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('link', { name: 'Linked tasks' })).toBeNull();
    expect(apiFetch.mock.calls.map(([, url]) => url)).toEqual(['/api/suite']);
  });

  it('renders the exact Linked tasks href in suite mode for a signed-in page', async () => {
    suiteAnswers();
    render(<SuiteDocLink archiveId={7} logId={42} />);
    const link = await screen.findByRole('link', { name: 'Linked tasks' });
    expect(link).toHaveAttribute('href', 'https://command.example.test/w/1/docs/7/42');
    expect(link).toHaveClass('suite-doc-link');
    expect(link).not.toHaveAttribute('target');
  });

  it('renders nothing when the links request fails (no session), rather than a dead link', async () => {
    suiteAnswers({ linksFail: true });
    const { container } = render(<SuiteDocLink archiveId={7} logId={42} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the server answers a non-http(s) URL', async () => {
    suiteAnswers({ links: { commandWorkspaceUrl: 'javascript:alert(1)' } });
    const { container } = render(<SuiteDocLink archiveId={7} logId={42} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the document is known (no archive id yet)', async () => {
    suiteAnswers();
    const { container } = render(<SuiteDocLink archiveId={undefined} logId="42" />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
