/**
 * The backup and restore drill on a live MySQL server: back up, destroy, restore, and find everything
 *
 * scripts/backup.sh and scripts/restore.sh are run for real, in their --local
 * form, which talks to MySQL with the mysql and mysqldump clients on PATH and
 * to the uploads directory on disk instead of going through Docker Compose.
 * Everything between the transport and the archive (the manifest, the
 * checksums, the refusals, the file modes) is the code the Compose form runs
 * too; the Compose transport itself is drilled by hand (docs/deployment.md,
 * Backups).
 *
 * The drill: a real server.js saves a document with a pasted image and a
 * comment, stops cleanly, and is backed up. Then the schema is dropped and the
 * image file deleted, the archive is restored into an empty scratch schema,
 * and a server booted on it answers /readyz 200, holds the document's HTML
 * byte for byte, and serves the image to its reader and to nobody else.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import mysql from 'mysql2/promise';
import sharp from 'sharp';
import * as Y from 'yjs';
import { c2_query } from '../../mysql_connect.js';
import { DOC_IMAGES_DIR } from '../../routes/helpers/images.js';
import { INSTANCE_LOCK_NAME_SQL } from '../../services/instance-lock.js';
import {
  adminConfig, buildSchemaFromInitSql, dropSchema, openAdminConnection, throwawaySchemaName,
} from './mysql-admin.js';
import {
  ADMIN, APP, freePort, holdLock, kill, killChildren, signIn, startServer,
} from './app-process.js';

const REPO_ROOT = path.resolve(APP, '..');
const BACKUP = path.join(REPO_ROOT, 'scripts', 'backup.sh');
const RESTORE = path.join(REPO_ROOT, 'scripts', 'restore.sh');
const COMMON = path.join(REPO_ROOT, 'scripts', 'backup-common.sh');
const UPLOADS = path.resolve(DOC_IMAGES_DIR, '..');

const admin = adminConfig();
const source = process.env.DB_NAME;      // this file's schema, built by setup.integration.js
const scratch = throwawaySchemaName();   // the empty schema the drill restores into
const elsewhere = throwawaySchemaName(); // a schema the restore must never reach
const fresh = throwawaySchemaName();     // a new install: init.sql's tables, no rows
// The shape the compose files give the app's MySQL user: everything on its
// own schema and nothing anywhere else. The backup runs as one such user, of
// the source, and the restore as another, of the scratch schema; neither
// script ever uses root.
const dumper = { user: throwawaySchemaName(), password: randomBytes(18).toString('base64url') };
const restorer = { user: throwawaySchemaName(), password: randomBytes(18).toString('base64url') };

const tmp = mkdtempSync(path.join(os.tmpdir(), 'c2-it-backup-'));
const scriptTmp = path.join(tmp, 'script-tmp'); // TMPDIR for the scripts, so leftovers are visible
const outDir = path.join(tmp, 'out');
const archive = path.join(outDir, 'drill.tar.gz');

const seen = {};             // what the running instance held before the backup
const imageFiles = [];       // image files this file put in the app's uploads directory
let adminConn;

afterEach(killChildren);

/**
 * Run a script with only the environment it is documented to read, and
 * resolve `{ code, stdout, stderr }` whether it succeeds or not.
 */
function run(script, args, env = {}) {
  const fullEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? tmp,
    TMPDIR: scriptTmp,
    DB_HOST: admin.host,
    DB_USER: admin.user,
    DB_PASS: admin.password,
    DB_NAME: source,
    ...env,
  };
  return new Promise((resolve) => {
    execFile('bash', [script, ...args], { env: fullEnv, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

/** Back up the source schema as its confined user. */
function backupAs(args) {
  return run(BACKUP, ['--local', ...args], { DB_USER: dumper.user, DB_PASS: dumper.password });
}

/** Restore as the confined user, into the scratch schema unless told otherwise. */
function restoreAs(args, env = {}) {
  return run(RESTORE, ['--local', ...args], {
    DB_USER: restorer.user, DB_PASS: restorer.password, DB_NAME: scratch, ...env,
  });
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** `tar` over execFile, resolving its stdout; throws on a non-zero exit. */
function tar(args) {
  return new Promise((resolve, reject) => {
    execFile('tar', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`tar ${args.join(' ')}: ${stderr}`));
      else resolve(stdout);
    });
  });
}

/** Unpack `file` into a fresh directory and return its path. */
async function unpack(file) {
  const dir = mkdtempSync(path.join(tmp, 'unpacked-'));
  await tar(['-xzf', file, '-C', dir]);
  return dir;
}

/**
 * A copy of the drill archive with `change(dir)` applied to its unpacked
 * members; the manifest's checksums are recomputed unless `keepManifest`.
 */
async function craft(name, change, { keepManifest = false } = {}) {
  const dir = await unpack(archive);
  await change(dir);
  if (!keepManifest) {
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.database_sql_sha256 = sha256(readFileSync(path.join(dir, 'database.sql')));
    manifest.app_public_sha256 = sha256(readFileSync(path.join(dir, 'app_public.tar.gz')));
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const out = path.join(tmp, `${name}.tar.gz`);
  await tar(['-czf', out, '-C', dir, ...readdirSync(dir)]);
  return out;
}

/** How many tables `schema` holds, seen as the admin. */
async function tableCount(schema) {
  const [[row]] = await adminConn.query(
    'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [schema]
  );
  return Number(row.n);
}

/** One row of `sql` against `schema`, as the admin. */
async function rowIn(schema, sql, params = []) {
  const conn = await mysql.createConnection({ ...admin, database: schema });
  try {
    const [rows] = await conn.query(sql, params);
    return rows[0];
  } finally {
    await conn.end();
  }
}

/** Fetch a document image from a running server, as `token`'s user or anonymously. */
async function fetchImage(port, hash, token) {
  const res = await fetch(`http://127.0.0.1:${port}/doc-images/${hash}.webp`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function api(port, token, method, url, body) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  expect(res.ok, `${res.status} ${JSON.stringify(json)}`).toBe(true);
  return json;
}

beforeAll(async () => {
  mkdirSync(scriptTmp);
  mkdirSync(outDir);
  adminConn = await openAdminConnection();
  await adminConn.query(`CREATE DATABASE ${mysql.escapeId(scratch)}`);
  await adminConn.query(`CREATE DATABASE ${mysql.escapeId(elsewhere)}`);
  for (const [who, schema] of [[dumper, source], [restorer, scratch]]) {
    await adminConn.query('CREATE USER ?@\'%\' IDENTIFIED BY ?', [who.user, who.password]);
    await adminConn.query(`GRANT ALL PRIVILEGES ON ${mysql.escapeId(schema)}.* TO ?@'%'`, [who.user]);
  }
  await adminConn.query(`GRANT ALL PRIVILEGES ON ${mysql.escapeId(fresh)}.* TO ?@'%'`, [restorer.user]);

  // A running instance: a document with a pasted image and some Unicode, a
  // comment on it, and collaborative state in its BLOB column.
  const port = await freePort();
  const server = await startServer(port);
  const token = await signIn(port);
  const [log] = await c2_query('SELECT id FROM logs ORDER BY id LIMIT 1', []);
  seen.logId = log.id;

  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: randomBytes(1)[0], g: randomBytes(1)[0], b: 7 } },
  }).png().toBuffer();
  await api(port, token, 'POST', '/api/save-document', {
    doc_id: log.id,
    html_content: `<h1>Drill ✓ 🛰️ «${randomBytes(4).toString('hex')}»</h1><p>before</p>`
      + `<img src="data:image/png;base64,${png.toString('base64')}"><p>after</p>`,
  });
  const [row] = await c2_query('SELECT html_content FROM logs WHERE id = ?', [log.id]);
  seen.html = row.html_content;
  const hash = /\/doc-images\/([0-9a-f]{16})\.webp/.exec(seen.html)?.[1];
  expect(hash, seen.html).toBeDefined();
  seen.hash = hash;
  imageFiles.push(path.join(DOC_IMAGES_DIR, `${hash}.webp`));
  await api(port, token, 'POST', `/api/logs/${log.id}/comments`, { content: 'Survives the drill 🧯' });
  const served = await fetchImage(port, hash, token);
  expect(served.status).toBe(200);
  seen.imageBytes = served.bytes;
  expect((await fetchImage(port, hash)).status).toBe(404);

  // A clean stop, which is when a backup holds every collaborative edit.
  const stopped = await kill(server, 'SIGTERM');
  expect(stopped.code, stopped.stderr).toBe(0);

  const ydoc = new Y.Doc();
  ydoc.getText('body').insert(0, 'collab state, bytes and all 🛰️');
  seen.ydoc = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  await c2_query('UPDATE logs SET ydoc_state = ? WHERE id = ?', [seen.ydoc, log.id]);
  seen.comments = await c2_query('SELECT id, content FROM comments WHERE log_id = ? ORDER BY id', [log.id]);
  seen.docImages = await c2_query('SELECT hash, log_id, uploaded_by FROM doc_images ORDER BY hash, log_id', []);
  expect(seen.comments).toHaveLength(1);
  expect(seen.docImages).toContainEqual(expect.objectContaining({ hash, log_id: log.id }));
}, 120_000);

afterAll(async () => {
  await killChildren();
  for (const file of imageFiles) rmSync(file, { force: true });
  if (adminConn) {
    await dropSchema(adminConn, scratch);
    await dropSchema(adminConn, elsewhere);
    await dropSchema(adminConn, fresh);
    for (const who of [dumper, restorer]) await adminConn.query('DROP USER IF EXISTS ?@\'%\'', [who.user]);
    await adminConn.end();
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('scripts/backup.sh', () => {
  it('writes one archive that only its owner can read, and leaves no working files behind', async () => {
    const result = await backupAs(['--uploads', UPLOADS, archive]);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(archive);
    expect(statSync(archive).mode & 0o777).toBe(0o600);
    expect(readdirSync(outDir)).toEqual(['drill.tar.gz']);
    expect(readdirSync(scriptTmp)).toEqual([]);
  });

  it('holds exactly the dump, the uploads and a manifest whose checksums match them', async () => {
    const members = (await tar(['-tzf', archive])).trim().split('\n').sort();
    expect(members).toEqual(['app_public.tar.gz', 'database.sql', 'manifest.json']);

    const dir = await unpack(archive);
    const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest).sort()).toEqual(
      ['app_public_sha256', 'app_version', 'created_at', 'database', 'database_sql_sha256', 'format'].sort()
    );
    expect(manifest.format).toBe(1);
    expect(manifest.database).toBe(source);
    expect(manifest.app_version).toBe(JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8')).version);
    expect(manifest.database_sql_sha256).toBe(sha256(readFileSync(path.join(dir, 'database.sql'))));
    expect(manifest.app_public_sha256).toBe(sha256(readFileSync(path.join(dir, 'app_public.tar.gz'))));

    const uploads = (await tar(['-tzf', path.join(dir, 'app_public.tar.gz')])).split('\n');
    expect(uploads).toContain(`./doc-images/${seen.hash}.webp`);
    const dump = readFileSync(path.join(dir, 'database.sql'), 'utf8');
    expect(dump).toMatch(/CREATE TABLE `schema_migrations`/);
    expect(dump).toMatch(/-- Dump completed/);
  });

  it('carries no credential: not the MySQL password it connected with, root\'s or the boot admin\'s', async () => {
    const dir = await unpack(archive);
    const everything = Buffer.concat([
      readFileSync(path.join(dir, 'manifest.json')),
      readFileSync(path.join(dir, 'database.sql')),
      gunzipSync(readFileSync(path.join(dir, 'app_public.tar.gz'))),
    ]);
    // Non-vacuity: the search does find what is in there.
    expect(everything.includes(Buffer.from(seen.hash))).toBe(true);
    expect(everything.includes(Buffer.from(dumper.password))).toBe(false);
    expect(everything.includes(Buffer.from(admin.password))).toBe(false);
    expect(everything.includes(Buffer.from(ADMIN.password))).toBe(false);
  });

  it('refuses to overwrite an existing file', async () => {
    const before = readFileSync(archive);
    const result = await backupAs(['--uploads', UPLOADS, archive]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/already exists/);
    expect(readFileSync(archive)).toEqual(before);
    expect(readdirSync(outDir)).toEqual(['drill.tar.gz']);
  });
});

describe('scripts/restore.sh refuses before it writes anything', () => {
  it('when the archive is for another database and --into does not name this one', async () => {
    const plain = await restoreAs(['--uploads', UPLOADS, archive]);
    expect(plain.code).not.toBe(0);
    expect(plain.stderr).toContain(source);
    expect(plain.stderr).toContain(scratch);
    expect(plain.stderr).toMatch(/--into/);

    const wrong = await restoreAs(['--into', elsewhere, '--uploads', UPLOADS, archive]);
    expect(wrong.code).not.toBe(0);
    expect(wrong.stderr).toContain(elsewhere);

    expect(await tableCount(scratch)).toBe(0);
    expect(await tableCount(elsewhere)).toBe(0);
  });

  it('when the target is a MySQL system schema', async () => {
    const result = await restoreAs(['--into', 'mysql', '--uploads', UPLOADS, archive], { DB_NAME: 'mysql' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/system schema/);
  });

  it('when a Cloud Codex process holds the target\'s instance lock', async () => {
    const holder = holdLock(scratch);
    expect((await holder.outcome).held).toBe(true);

    const result = await restoreAs(['--into', scratch, '--uploads', UPLOADS, archive]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/instance lock/);
    expect(await tableCount(scratch)).toBe(0);
  });

  it('when a payload does not match the manifest\'s checksum', async () => {
    const tampered = await craft('tampered', (dir) => {
      appendFileSync(path.join(dir, 'database.sql'), 'DELETE FROM users;\n');
    }, { keepManifest: true });

    const result = await restoreAs(['--into', scratch, '--uploads', UPLOADS, tampered]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/checksum/);
    expect(await tableCount(scratch)).toBe(0);
  });

  it('when the archive holds anything besides its three members', async () => {
    const extra = await craft('extra', (dir) => { writeFileSync(path.join(dir, 'run-me.sh'), 'echo hi\n'); });

    const result = await restoreAs(['--into', scratch, '--uploads', UPLOADS, extra]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/exactly/);
    expect(await tableCount(scratch)).toBe(0);
  });

  it('when the dump would switch to another database or run a client command', async () => {
    const pwned = path.join(tmp, 'pwned');
    for (const line of [`USE \`${elsewhere}\`;`, `CREATE DATABASE \`${elsewhere}x\`;`, `\\! touch ${pwned}`, `system touch ${pwned}`]) {
      const hostile = await craft('hostile', (dir) => {
        const file = path.join(dir, 'database.sql');
        writeFileSync(file, `${line}\n${readFileSync(file, 'utf8')}`);
      });

      const result = await restoreAs(['--into', scratch, '--uploads', UPLOADS, hostile]);

      expect(result.code, line).not.toBe(0);
      expect(result.stderr, line).toMatch(/refusing to load/i);
    }
    expect(existsSync(pwned)).toBe(false);
    expect(await tableCount(scratch)).toBe(0);
  });

  it('when the dump hides a client command after a statement on the same line', async () => {
    // The line-start scan cannot see these; the client itself must refuse
    // them, and stop before the load writes anything.
    const teed = path.join(tmp, 'teed');
    for (const line of [`SELECT 1; \\T ${teed}`, `SELECT 1; \\! touch ${teed}`]) {
      const hidden = await craft('midline', (dir) => {
        const file = path.join(dir, 'database.sql');
        writeFileSync(file, `${line}\n${readFileSync(file, 'utf8')}`);
      });

      const result = await restoreAs(['--into', scratch, '--uploads', UPLOADS, hidden]);

      expect(result.code, line).not.toBe(0);
      expect(result.stderr, line).toMatch(/Unknown command|disabled/i);
      expect(existsSync(teed), line).toBe(false);
      expect(await tableCount(scratch), line).toBe(0);
    }
  });

  it('when the uploads hold a link or a path that climbs out', async () => {
    const linked = await craft('linked', async (dir) => {
      const up = path.join(dir, 'up');
      mkdirSync(up);
      await tar(['-xzf', path.join(dir, 'app_public.tar.gz'), '-C', up]);
      await new Promise((resolve, reject) => {
        execFile('ln', ['-s', '/etc', path.join(up, 'doc-images', 'etc')], (err) => (err ? reject(err) : resolve()));
      });
      await tar(['-czf', path.join(dir, 'app_public.tar.gz'), '-C', up, '.']);
      rmSync(up, { recursive: true });
    });

    const result = await restoreAs(['--into', scratch, '--uploads', UPLOADS, linked]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/regular files and directories/);
    expect(await tableCount(scratch)).toBe(0);
  });
});

describe('the restore\'s load session', () => {
  /** TAKE_LOCK_SQL as scripts/backup-common.sh defines it, expanded by Bash. */
  function takeLockSql() {
    return new Promise((resolve, reject) => {
      execFile('bash', ['-c', '. "$1"; printf %s "$TAKE_LOCK_SQL"', 'bash', COMMON], (err, stdout, stderr) => {
        if (err || !stdout) reject(new Error(`TAKE_LOCK_SQL: ${stderr || 'empty'}`));
        else resolve(stdout);
      });
    });
  }

  it('fails at its first statement while another process holds the instance lock, and holds the lock otherwise', async () => {
    // restore.sh checks IS_FREE_LOCK, then starts the load; a server that
    // takes the lock between the two must stop the load before the drops.
    const sql = await takeLockSql();
    const holder = holdLock(scratch);
    expect((await holder.outcome).held).toBe(true);
    const conn = await mysql.createConnection({ ...admin, database: scratch });
    try {
      await expect(conn.query(sql)).rejects.toThrow(/instance lock/);

      await kill(holder, 'SIGKILL');
      await conn.query(sql);
      const [[row]] = await conn.query(`SELECT IS_USED_LOCK(${INSTANCE_LOCK_NAME_SQL}) = CONNECTION_ID() AS mine`);
      expect(Number(row.mine)).toBe(1);
    } finally {
      await conn.end();
    }
  });
});

describe('the drill: destroy the instance, restore it, and find everything', () => {
  it('restores into an empty schema; the server is ready, the HTML is byte-identical, the image reaches its reader only', { timeout: 120_000 }, async () => {
    // Destroy: the database and the image file are gone.
    await dropSchema(adminConn, source);
    rmSync(path.join(DOC_IMAGES_DIR, `${seen.hash}.webp`));
    expect(existsSync(path.join(DOC_IMAGES_DIR, `${seen.hash}.webp`))).toBe(false);

    const result = await restoreAs(['--into', scratch, '--uploads', UPLOADS, archive]);
    expect(result.code, result.stderr).toBe(0);
    expect(readdirSync(scriptTmp)).toEqual([]);

    const row = await rowIn(scratch, 'SELECT html_content, ydoc_state FROM logs WHERE id = ?', [seen.logId]);
    expect(Buffer.from(row.html_content, 'utf8').equals(Buffer.from(seen.html, 'utf8'))).toBe(true);
    expect(Buffer.from(row.ydoc_state).equals(seen.ydoc)).toBe(true);
    const conn = await mysql.createConnection({ ...admin, database: scratch });
    try {
      const [comments] = await conn.query('SELECT id, content FROM comments WHERE log_id = ? ORDER BY id', [seen.logId]);
      expect(comments).toEqual(seen.comments);
      const [docImages] = await conn.query('SELECT hash, log_id, uploaded_by FROM doc_images ORDER BY hash, log_id');
      expect(docImages).toEqual(seen.docImages);
    } finally {
      await conn.end();
    }
    expect(readFileSync(path.join(DOC_IMAGES_DIR, `${seen.hash}.webp`)).equals(seen.imageBytes)).toBe(true);

    const port = await freePort();
    const server = await startServer(port, { DB_NAME: scratch });  // resolves only on /readyz 200
    const token = await signIn(port);
    const doc = await api(port, token, 'GET', `/api/document?doc_id=${seen.logId}`);
    expect(JSON.stringify(doc)).toContain(`/doc-images/${seen.hash}.webp`);
    const served = await fetchImage(port, seen.hash, token);
    expect(served.status).toBe(200);
    expect(served.bytes.equals(seen.imageBytes)).toBe(true);
    expect((await fetchImage(port, seen.hash)).status).toBe(404);
    const stopped = await kill(server, 'SIGTERM');
    expect(stopped.code, stopped.stderr).toBe(0);
  });

  it('will not load over a database that has tables unless told --replace', async () => {
    const result = await restoreAs(['--into', scratch, '--uploads', UPLOADS, archive]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/--replace/);
  });

  it('--replace makes the database, avatars/ and doc-images/ exactly the backup\'s, and removes nothing else', async () => {
    const uploads = mkdtempSync(path.join(tmp, 'uploads-'));
    mkdirSync(path.join(uploads, 'doc-images'));
    writeFileSync(path.join(uploads, 'doc-images', 'stray.webp'), 'not in the backup');
    writeFileSync(path.join(uploads, 'keep.txt'), 'outside avatars/ and doc-images/');
    await adminConn.query(`CREATE TABLE ${mysql.escapeId(scratch)}.stray (id INT)`);
    await adminConn.query(`UPDATE ${mysql.escapeId(scratch)}.logs SET html_content = '<p>changed</p>' WHERE id = ?`, [seen.logId]);

    const result = await restoreAs(['--into', scratch, '--replace', '--uploads', uploads, archive]);

    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(path.join(uploads, 'doc-images', 'stray.webp'))).toBe(false);
    expect(readFileSync(path.join(uploads, 'keep.txt'), 'utf8')).toBe('outside avatars/ and doc-images/');
    expect(readFileSync(path.join(uploads, 'doc-images', `${seen.hash}.webp`)).equals(seen.imageBytes)).toBe(true);
    const [[stray]] = await adminConn.query(
      'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [scratch, 'stray']
    );
    expect(Number(stray.n)).toBe(0);
    const row = await rowIn(scratch, 'SELECT html_content FROM logs WHERE id = ?', [seen.logId]);
    expect(row.html_content).toBe(seen.html);
  });

  it('restores onto a new install\'s empty tables without --replace, since dropping them loses nothing', async () => {
    const conn = await openAdminConnection();
    try {
      await buildSchemaFromInitSql(conn, fresh);
    } finally {
      await conn.end();
    }
    const built = await tableCount(fresh);
    expect(built).toBeGreaterThan(0);

    const result = await restoreAs(['--into', fresh, '--uploads', mkdtempSync(path.join(tmp, 'u-')), archive], { DB_NAME: fresh });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/only empty tables/);
    const row = await rowIn(fresh, 'SELECT html_content FROM logs WHERE id = ?', [seen.logId]);
    expect(row.html_content).toBe(seen.html);
  });

  it('cannot write outside its own database: a dump that names another schema fails on the grant', async () => {
    const escaping = await craft('escaping', (dir) => {
      const file = path.join(dir, 'database.sql');
      writeFileSync(file, `CREATE TABLE \`${elsewhere}\`.\`escaped\` (id INT);\n${readFileSync(file, 'utf8')}`);
    });

    const result = await restoreAs(['--into', scratch, '--replace', '--uploads', mkdtempSync(path.join(tmp, 'u-')), escaping]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/denied/i);
    expect(await tableCount(elsewhere)).toBe(0);
  });
});
