/**
 * Cloud Codex - Tests for routes/doc-images-serve.js
 *
 * The /doc-images mount: a document image goes to its uploader and to anyone
 * who can read a document that holds it, and to nobody else. Every refusal is
 * the same empty 404, so the answer never says whether a file exists, whether
 * the caller is signed in, or whether a document holds the image.
 * DOC_IMAGES_PUBLIC=1 puts back the public static mount.
 *
 * sendFile reads through node:fs, which tests/setup.js does not mock, so the
 * served bytes come from a real temporary directory.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import app from '../../app.js';
import { c2_query, validateAndAutoLogin } from '../../mysql_connect.js';
import { readAccessParams } from '../../routes/helpers/ownership.js';
import { docImagesHandler } from '../../routes/doc-images-serve.js';
import { mockAuthenticated, resetMocks, TEST_USER } from '../helpers.js';

const HASH = '0123456789abcdef';
const MISSING = 'fedcba9876543210';
const BYTES = Buffer.from('RIFF....WEBPVP8 fake webp bytes');

let dir;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'c2-doc-images-'));
  writeFileSync(path.join(dir, `${HASH}.webp`), BYTES);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => resetMocks());

/** An app with only the handler mounted where app.js mounts it, over the temp dir. */
function appOver(directory = dir) {
  const a = express();
  a.use('/doc-images', docImagesHandler({ dir: directory }));
  return a;
}

/** Run `fn` with DOC_IMAGES_PUBLIC set to `value` (undefined unsets it), then restore. */
async function withPublicFlag(value, fn) {
  const prior = process.env.DOC_IMAGES_PUBLIC;
  if (value === undefined) delete process.env.DOC_IMAGES_PUBLIC;
  else process.env.DOC_IMAGES_PUBLIC = value;
  try {
    return await fn();
  } finally {
    if (prior === undefined) delete process.env.DOC_IMAGES_PUBLIC;
    else process.env.DOC_IMAGES_PUBLIC = prior;
  }
}

/** Everything a caller can observe about a response, minus the clock. */
function observable(res) {
  const { date: _date, ...headers } = res.headers;
  return { status: res.status, headers, body: res.text ?? '' };
}

/** The readable-images query this handler issues, if it issued one. */
const imageQueries = () => c2_query.mock.calls.filter(([sql]) => /FROM doc_images di/.test(sql));

describe('GET /doc-images/:file (authorized, the default)', () => {
  it('serves a reader the bytes as image/webp, privately cached', async () => {
    mockAuthenticated();
    c2_query.mockResolvedValueOnce([{ hash: HASH }]);

    const res = await request(appOver())
      .get(`/doc-images/${HASH}.webp`)
      .set('Cookie', 'sessionToken=reader-token');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(res.body)).toEqual(BYTES);
    expect(validateAndAutoLogin).toHaveBeenCalledWith('reader-token');
  });

  it('asks one question: is this user the uploader, or a reader of a document holding it', async () => {
    mockAuthenticated();
    c2_query.mockResolvedValueOnce([{ hash: HASH }]);

    await request(appOver()).get(`/doc-images/${HASH}.webp`).set('Cookie', 'sessionToken=t');

    const [[sql, params]] = imageQueries();
    expect(sql).toMatch(/di\.uploaded_by = \? OR/);
    expect(params).toEqual([HASH, TEST_USER.id, ...readAccessParams(TEST_USER)]);
  });

  it('accepts the session from an Authorization header as well as the cookie', async () => {
    mockAuthenticated();
    c2_query.mockResolvedValueOnce([{ hash: HASH }]);

    const res = await request(appOver())
      .get(`/doc-images/${HASH}.webp`)
      .set('Authorization', 'Bearer header-token');

    expect(res.status).toBe(200);
    expect(validateAndAutoLogin).toHaveBeenCalledWith('header-token');
  });

  it('never extends the session on an image load', async () => {
    const { touchSession } = await import('../../mysql_connect.js');
    mockAuthenticated();
    c2_query.mockResolvedValueOnce([{ hash: HASH }]);
    await request(appOver()).get(`/doc-images/${HASH}.webp`).set('Cookie', 'sessionToken=t');
    expect(touchSession).not.toHaveBeenCalled();
  });

  describe('every refusal is the same empty 404', () => {
    // Each case is a request plus the mocks that put the handler in that state.
    const cases = {
      'anonymous (no session at all)': {
        path: `/doc-images/${HASH}.webp`,
        setup: () => {},
      },
      'an expired or unknown session': {
        path: `/doc-images/${HASH}.webp`,
        cookie: 'sessionToken=stale',
        setup: () => validateAndAutoLogin.mockResolvedValue(null),
      },
      'a signed-in user who cannot read any document holding it': {
        path: `/doc-images/${HASH}.webp`,
        cookie: 'sessionToken=t',
        setup: () => {
          mockAuthenticated();
          c2_query.mockResolvedValueOnce([]);
        },
      },
      'a reader whose file is missing on disk': {
        path: `/doc-images/${MISSING}.webp`,
        cookie: 'sessionToken=t',
        setup: () => {
          mockAuthenticated();
          c2_query.mockResolvedValueOnce([{ hash: MISSING }]);
        },
      },
      'a name that is not a served image': {
        path: '/doc-images/..%2F..%2Fpackage.json',
        cookie: 'sessionToken=t',
        setup: () => mockAuthenticated(),
      },
      'an uppercase hash': {
        path: `/doc-images/${HASH.toUpperCase()}.webp`,
        cookie: 'sessionToken=t',
        setup: () => mockAuthenticated(),
      },
      'a nested path': {
        path: `/doc-images/sub/${HASH}.webp`,
        cookie: 'sessionToken=t',
        setup: () => mockAuthenticated(),
      },
    };

    const responses = {};

    for (const [name, { path: p, cookie, setup }] of Object.entries(cases)) {
      it(name, async () => {
        setup();
        const req = request(appOver()).get(p);
        if (cookie) req.set('Cookie', cookie);
        const res = await req;
        expect(res.status).toBe(404);
        expect(res.text).toBe('');
        expect(res.headers['content-type']).toBeUndefined();
        expect(res.headers['cache-control']).toBe('no-store');
        responses[name] = observable(res);
      });
    }

    it('and all of them are byte-identical', () => {
      const shapes = Object.values(responses);
      expect(shapes).toHaveLength(Object.keys(cases).length);
      for (const shape of shapes) expect(shape).toEqual(shapes[0]);
    });

    it('asks the database nothing for an anonymous caller or a bad name', async () => {
      await request(appOver()).get(`/doc-images/${HASH}.webp`);
      mockAuthenticated();
      await request(appOver()).get('/doc-images/nothex.webp').set('Cookie', 'sessionToken=t');
      expect(validateAndAutoLogin).toHaveBeenCalledTimes(0);
      expect(c2_query).not.toHaveBeenCalled();
    });
  });

  it('answers a database failure with the JSON 500, not a 404 and not a stack trace', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAuthenticated();
    c2_query.mockRejectedValueOnce(new Error('db down'));

    const res = await request(appOver()).get(`/doc-images/${HASH}.webp`).set('Cookie', 'sessionToken=t');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'An internal server error occurred' });
    errorSpy.mockRestore();
  });

  it('forwards a read error that is not a missing file to the error handler', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAuthenticated();
    c2_query.mockResolvedValueOnce([{ hash: HASH }]);
    // A directory where the file should be: sendFile fails, and not with a 404.
    const broken = mkdtempSync(path.join(tmpdir(), 'c2-doc-images-broken-'));
    try {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path.join(broken, `${HASH}.webp`));
      const res = await request(appOver(broken)).get(`/doc-images/${HASH}.webp`).set('Cookie', 'sessionToken=t');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, message: 'An internal server error occurred' });
      expect(res.headers['cache-control']).not.toBe('private, max-age=86400');
    } finally {
      rmSync(broken, { recursive: true, force: true });
      errorSpy.mockRestore();
    }
  });
});

describe('the mount in app.js', () => {
  it('is the authorized handler: an anonymous request gets the empty 404, never the static file server', async () => {
    const res = await request(app).get('/doc-images/0a2de7531914d005.webp');
    expect(res.status).toBe(404);
    expect(res.text).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('DOC_IMAGES_PUBLIC=1', () => {
  it('mounts the public static handler: no session, no query, 30-day public caching', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await withPublicFlag('1', () => request(appOver()).get(`/doc-images/${HASH}.webp`));
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('public, max-age=2592000, immutable');
      expect(Buffer.from(res.body)).toEqual(BYTES);
      expect(validateAndAutoLogin).not.toHaveBeenCalled();
      expect(c2_query).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('says so once, at mount time, so an operator does not forget it is on', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withPublicFlag('1', () => docImagesHandler({ dir }));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0].join(' ')).toMatch(/DOC_IMAGES_PUBLIC=1/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('is exactly "1": any other value keeps images authorized', async () => {
    for (const value of ['true', '0', 'yes']) {
      const res = await withPublicFlag(value, () => request(appOver()).get(`/doc-images/${HASH}.webp`));
      expect(res.status).toBe(404);
    }
  });
});
