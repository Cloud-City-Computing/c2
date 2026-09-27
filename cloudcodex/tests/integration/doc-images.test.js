/**
 * Document images on a live MySQL server: readers see them, nobody else does
 *
 * The handler's question (is this user the uploader, or a reader of any
 * document that holds the image?) is one query composing the archive read
 * fragment, and the backfill and the write-path gate are SQL too, so only a
 * real server proves them. Every request here goes through the real app, the
 * real session lookup and the real image files on disk: a seeded document
 * with an image in its HTML, the backfill, then its reader gets the bytes and
 * a stranger gets the same 404 an anonymous caller does.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import app from '../../app.js';
import { c2_query, generateSessionToken } from '../../mysql_connect.js';
import { DOC_IMAGES_DIR } from '../../routes/helpers/images.js';
import { backfillDocImages } from '../../scripts/backfill-doc-images.js';

const tag = randomBytes(3).toString('hex');
const hex16 = () => randomBytes(8).toString('hex');

/** In a document's HTML (backfilled) and in one of its versions only (backfilled). */
const IN_DOC = hex16();
const IN_VERSION = hex16();
const BYTES = { [IN_DOC]: randomBytes(64), [IN_VERSION]: randomBytes(64) };

const filesWritten = [];
const ids = {};
const tokens = {};

const img = (hash) => `<p>pic</p><img src="/doc-images/${hash}.webp">`;

async function user(name) {
  const r = await c2_query('INSERT INTO users (name, email) VALUES (?, ?)', [`${name}${tag}`, `${name}${tag}@example.com`]);
  ids[name] = r.insertId;
  tokens[name] = await generateSessionToken({ id: r.insertId });
  return r.insertId;
}

/** A workspace, squad and archive owned and created by `owner`. */
async function place(owner, label) {
  const ws = await c2_query('INSERT INTO workspaces (name, owner_id) VALUES (?, ?)', [`${label}${tag}`, owner]);
  const squad = await c2_query('INSERT INTO squads (workspace_id, name, created_by) VALUES (?, ?, ?)', [ws.insertId, label, owner]);
  const archive = await c2_query('INSERT INTO archives (squad_id, name, created_by) VALUES (?, ?, ?)', [squad.insertId, label, owner]);
  return { squad: squad.insertId, archive: archive.insertId };
}

async function doc(archive, owner, html) {
  const r = await c2_query(
    'INSERT INTO logs (archive_id, title, html_content, created_by, updated_by) VALUES (?, ?, ?, ?, ?)',
    [archive, 'doc', html, owner, owner]
  );
  return r.insertId;
}

const fetchImage = (hash, who) => {
  const req = request(app).get(`/doc-images/${hash}.webp`);
  return who ? req.set('Authorization', `Bearer ${tokens[who]}`) : req;
};

/** Everything a caller can observe about a response, minus the clock. */
function observable(res) {
  const { date: _date, ...headers } = res.headers;
  return { status: res.status, headers, body: res.text ?? '' };
}

async function expectServed(hash, who, bytes = BYTES[hash]) {
  const res = await fetchImage(hash, who);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('image/webp');
  expect(res.headers['cache-control']).toBe('private, max-age=86400');
  if (bytes) expect(Buffer.from(res.body)).toEqual(bytes);
}

async function expectRefused(hash, who) {
  const res = await fetchImage(hash, who);
  const anonymous = await fetchImage(hash);
  expect(res.status).toBe(404);
  expect(observable(res)).toEqual(observable(anonymous));
}

const rowsFor = (hash) =>
  c2_query('SELECT log_id, uploaded_by FROM doc_images WHERE hash = ? ORDER BY log_id', [hash]);

beforeAll(async () => {
  for (const [hash, bytes] of Object.entries(BYTES)) {
    const file = path.join(DOC_IMAGES_DIR, `${hash}.webp`);
    writeFileSync(file, bytes);
    filesWritten.push(file);
  }

  await user('owner');
  await user('reader');
  await user('writer');
  await user('stranger');
  await user('bReader');

  // Archive A: the owner's, with a reader (can_read) and a writer (can_write).
  const a = await place(ids.owner, 'A');
  ids.archiveA = a.archive;
  await c2_query('INSERT INTO squad_members (squad_id, user_id, can_read) VALUES (?, ?, TRUE)', [a.squad, ids.reader]);
  await c2_query('INSERT INTO squad_members (squad_id, user_id, can_read, can_write) VALUES (?, ?, TRUE, TRUE)', [a.squad, ids.writer]);
  ids.docA = await doc(a.archive, ids.owner, img(IN_DOC));
  await c2_query(
    'INSERT INTO versions (log_id, version, html_content, created_by) VALUES (?, 1, ?, ?)',
    [ids.docA, img(IN_VERSION), ids.owner]
  );

  // Archive B: the owner's too, read by bReader, who cannot read A.
  const b = await place(ids.owner, 'B');
  await c2_query('INSERT INTO squad_members (squad_id, user_id, can_read) VALUES (?, ?, TRUE)', [b.squad, ids.bReader]);
  ids.docB = await doc(b.archive, ids.owner, '<p>empty</p>');

  // The stranger's own place: somewhere they can write, and nothing of A's.
  const s = await place(ids.stranger, 'S');
  ids.docS = await doc(s.archive, ids.stranger, '<p>mine</p>');
});

afterAll(() => {
  for (const file of filesWritten) rmSync(file, { force: true });
});

describe('document images on live MySQL', () => {
  it('before the backfill, an existing image is hidden even from its reader', async () => {
    await expectRefused(IN_DOC, 'reader');
  });

  it('the backfill records every image a document or its versions show, and only once', async () => {
    expect(await backfillDocImages()).toEqual({ documents: 1, versions: 1, recorded: 2 });
    expect(await rowsFor(IN_DOC)).toEqual([{ log_id: ids.docA, uploaded_by: null }]);
    expect(await rowsFor(IN_VERSION)).toEqual([{ log_id: ids.docA, uploaded_by: null }]);
    expect((await backfillDocImages()).recorded).toBe(0);
  });

  it('after it, the reader and the owner get the bytes, privately cached', async () => {
    await expectServed(IN_DOC, 'reader');
    await expectServed(IN_VERSION, 'reader');
    await expectServed(IN_DOC, 'owner');
  });

  it('the session cookie an <img> request carries works as well as the header', async () => {
    const res = await request(app).get(`/doc-images/${IN_DOC}.webp`).set('Cookie', `sessionToken=${tokens.reader}`);
    expect(res.status).toBe(200);
  });

  it('a stranger gets exactly what an anonymous caller gets', async () => {
    await expectRefused(IN_DOC, 'stranger');
    await expectRefused(IN_VERSION, 'stranger');
    await expectRefused(IN_DOC, 'bReader');
  });

  it('export still inlines the image for a reader', async () => {
    const res = await request(app)
      .get(`/api/document/${ids.docA}/export?format=html`)
      .set('Authorization', `Bearer ${tokens.reader}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`data:image/webp;base64,${BYTES[IN_DOC].toString('base64')}`);
    expect(res.text).not.toContain(`/doc-images/${IN_DOC}.webp`);
  });

  it('knowing the address is not enough: a stranger who pastes it into their own document gains nothing', async () => {
    const saved = await request(app)
      .post('/api/save-document')
      .set('Authorization', `Bearer ${tokens.stranger}`)
      .send({ doc_id: ids.docS, html_content: img(IN_DOC) });
    expect(saved.status).toBe(200);

    expect((await rowsFor(IN_DOC)).map((r) => r.log_id)).toEqual([ids.docA]);
    await expectRefused(IN_DOC, 'stranger');

    // Nor can they export their way to the bytes.
    const exported = await request(app)
      .get(`/api/document/${ids.docS}/export?format=html`)
      .set('Authorization', `Bearer ${tokens.stranger}`);
    expect(exported.status).toBe(200);
    expect(exported.text).toContain(`/doc-images/${IN_DOC}.webp`);
    expect(exported.text).not.toContain(BYTES[IN_DOC].toString('base64'));
  });

  it('someone who can see an image can put it in another document, and that document\'s readers then see it', async () => {
    await expectRefused(IN_DOC, 'bReader');

    const saved = await request(app)
      .post('/api/save-document')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({ doc_id: ids.docB, html_content: img(IN_DOC) });
    expect(saved.status).toBe(200);

    expect(await rowsFor(IN_DOC)).toEqual([
      { log_id: ids.docA, uploaded_by: null },
      { log_id: ids.docB, uploaded_by: null },
    ]);
    await expectServed(IN_DOC, 'bReader');
  });

  it('deleting that document takes its readers\' access with it', async () => {
    await c2_query('DELETE FROM logs WHERE id = ?', [ids.docB]);
    expect((await rowsFor(IN_DOC)).map((r) => r.log_id)).toEqual([ids.docA]);
    await expectRefused(IN_DOC, 'bReader');
  });

  describe('an upload', () => {
    let hash;
    let bytes;

    beforeAll(async () => {
      const [r, g, b] = randomBytes(3);
      const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r, g, b } } }).png().toBuffer();
      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', `Bearer ${tokens.writer}`)
        .field('logId', String(ids.docA))
        .attach('files', png, 'pasted.png');
      expect(res.status).toBe(200);
      const url = res.body.urls[0];
      hash = /^\/doc-images\/([0-9a-f]{16})\.webp$/.exec(url)[1];
      const file = path.join(DOC_IMAGES_DIR, `${hash}.webp`);
      filesWritten.push(file);
      expect(existsSync(file)).toBe(true);
      bytes = readFileSync(file);
    });

    it('is recorded against its document as the uploader\'s', async () => {
      expect(await rowsFor(hash)).toEqual([{ log_id: ids.docA, uploaded_by: ids.writer }]);
    });

    it('is visible to the document\'s readers at once, before anyone saves', async () => {
      await expectServed(hash, 'reader', bytes);
      await expectRefused(hash, 'stranger');
    });

    it('stays visible to its uploader after they lose access to the document', async () => {
      await c2_query('DELETE FROM squad_members WHERE user_id = ?', [ids.writer]);
      const doc = await request(app).get(`/api/document?doc_id=${ids.docA}`).set('Authorization', `Bearer ${tokens.writer}`);
      expect(doc.status).toBe(404);
      await expectServed(hash, 'writer', bytes);
    });

    it('is refused into a document the uploader cannot write, and nothing is written', async () => {
      const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
      // Cleaned up even if a regression writes it, so a failure leaves nothing behind.
      const file = path.join(DOC_IMAGES_DIR, `${createHash('sha256').update(png).digest('hex').slice(0, 16)}.webp`);
      filesWritten.push(file);
      const res = await request(app)
        .post('/api/doc-images/upload')
        .set('Authorization', `Bearer ${tokens.stranger}`)
        .field('logId', String(ids.docA))
        .attach('files', png, 'nope.png');
      expect(res.status).toBe(403);
      expect(existsSync(file)).toBe(false);
      const [{ n }] = await c2_query('SELECT COUNT(*) AS n FROM doc_images WHERE uploaded_by = ?', [ids.stranger]);
      expect(n).toBe(0);
    });
  });
});
