/**
 * Many instances on one MySQL server: the grant recipe keeps each inside its own schema
 *
 * docs/deployment.md's "Several instances on one MySQL server" gives every
 * instance a schema, an app account that holds SELECT, INSERT, UPDATE and
 * DELETE on that schema and nothing else, and a migration account that holds
 * every privilege on that schema and nothing global. This file runs that
 * recipe, as written, for two instances on one server, builds one by the
 * fresh-install path and the other by the upgrade path (both as their
 * migration account), and then tries every cross-schema shape it knows as
 * instance A's accounts. Each must fail with the error MySQL 8.4 gives for a
 * missing privilege, never with an empty answer, and instance B's row is
 * there to be found if one ever succeeded.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { listMigrationFiles, LEGACY_BASELINE, MIGRATIONS_DIR } from '../../scripts/migrate.js';
import {
  dropSchema,
  dropUser,
  isThrowawaySchema,
  openAdminConnection,
  SCHEMA_PREFIX,
  throwawaySchemaName,
} from './mysql-admin.js';
import {
  buildFresh,
  buildUpgraded,
  connectAs,
  newInstance,
  provision,
  recipeSection,
  recipeSql,
  unprovision,
} from './instance-recipe.js';
import { holdLock, killChildren } from './server-child.js';

const ER_DBACCESS_DENIED_ERROR = 1044;
const ER_ACCESS_DENIED_ERROR = 1045;
const ER_KILL_DENIED_ERROR = 1095;
const ER_TABLEACCESS_DENIED_ERROR = 1142;
const ER_USER_LIMIT_REACHED = 1226;
const ER_SPECIFIC_ACCESS_DENIED_ERROR = 1227;
const ER_PROCACCESS_DENIED_ERROR = 1370;
const ER_WRONG_STRING_LENGTH = 1470;

const SECRET = 'instance b, not for instance a';

const a = newInstance();
const b = newInstance();
const postBaseline = listMigrationFiles(MIGRATIONS_DIR).filter((f) => !LEGACY_BASELINE.includes(f));

let admin;
let appA;
let migA;
let appB;
let upgradedB;

beforeAll(async () => {
  admin = await openAdminConnection();
  await provision(admin, a);
  await provision(admin, b);
  await buildFresh(a);
  upgradedB = await buildUpgraded(b);

  appA = await connectAs(a.app, a.schema);
  migA = await connectAs(a.mig, a.schema);
  appB = await connectAs(b.app, b.schema);
  await appB.query('INSERT INTO users (name, email) VALUES (?, ?)', [SECRET, 'b-secret@example.com']);
  const migB = await connectAs(b.mig, b.schema);
  try {
    await migB.query('CREATE PROCEDURE probe() SELECT name FROM users');
  } finally {
    await migB.end();
  }
}, 180_000); // two schemas and a full upgrade path, as in upgrade-path.test.js

afterAll(async () => {
  for (const conn of [appA, migA, appB]) await conn?.end();
  await unprovision(admin, a);
  await unprovision(admin, b);
  await admin.end();
});

afterEach(killChildren);

/** `sql` with {A} and {B} as the two schemas, escaped, and {B_CONN} as app B's connection id. */
async function statement(sql) {
  const [[{ id }]] = await appB.query('SELECT CONNECTION_ID() AS id');
  return sql
    .replaceAll('{A}', mysql.escapeId(a.schema))
    .replaceAll('{B}', mysql.escapeId(b.schema))
    .replaceAll('{B_APP}', mysql.escape(b.app.user))
    .replaceAll('{B_CONN}', String(id));
}

/** The MySQL error number `sql` fails with as `conn`, or 'succeeded'. */
async function errnoOf(conn, sql) {
  try {
    await conn.query(await statement(sql));
    return 'succeeded';
  } catch (err) {
    return err.errno;
  }
}

describe('the recipe, as written in docs/deployment.md', () => {
  it('names a schema of letters and digits only, so its grant is not a pattern', () => {
    const grants = recipeSql().match(/\bON\s+(\S+)\.\*/g);
    expect(grants).toHaveLength(2);
    for (const grant of grants) expect(grant).toMatch(/^ON `[a-z0-9]+`\.\*$/);
  });

  // Each account is the schema name plus _app or _mig, and MySQL refuses a
  // user name longer than 32 characters, so the recipe has to cap the schema
  // name at 28. A 28-character name gives a 32-character account, which MySQL
  // takes; one character more is refused with ER_WRONG_STRING_LENGTH.
  it('says an account name is at most 32 characters, so a schema name at most 28, as MySQL enforces', async () => {
    expect(recipeSection()).toMatch(/user name to 32 characters, so with `_app` or `_mig` appended the\s+schema name can be at most 28 characters\./);
    const schema = `${SCHEMA_PREFIX}${randomBytes(11).toString('hex')}`;
    expect(schema).toHaveLength(28);
    try {
      for (const suffix of ['_app', '_mig']) {
        await admin.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [`${schema}${suffix}`, randomBytes(18).toString('base64url')]);
        expect(await errnoOf(admin, `CREATE USER '${schema}x${suffix}'@'%'`)).toBe(ER_WRONG_STRING_LENGTH);
      }
    } finally {
      for (const suffix of ['_app', '_mig']) await dropUser(admin, `${schema}${suffix}`);
    }
  });

  it('builds both ways as the migration account alone', async () => {
    // The upgrade path ran every post-baseline file for real, CREATE
    // PROCEDURE included, with binary logging on (MySQL 8.4's default).
    expect(postBaseline.length).toBeGreaterThan(0);
    expect(upgradedB).toEqual(postBaseline);
    const [[{ n }]] = await appA.query('SELECT COUNT(*) AS n FROM schema_migrations');
    expect(n).toBe(listMigrationFiles(MIGRATIONS_DIR).length);
    const [[{ bin }]] = await appA.query('SELECT @@log_bin AS bin');
    expect(bin).toBe(1);
  });

  it('gives the app account DML on its schema and nothing else, nothing global', async () => {
    const [rows] = await appA.query('SHOW GRANTS');
    expect(rows.map((row) => Object.values(row)[0])).toEqual([
      `GRANT USAGE ON *.* TO \`${a.app.user}\`@\`%\``,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${a.schema}\`.* TO \`${a.app.user}\`@\`%\``,
    ]);
  });

  it('gives the migration account its schema only, without GRANT OPTION, nothing global', async () => {
    const [rows] = await migA.query('SHOW GRANTS');
    expect(rows.map((row) => Object.values(row)[0])).toEqual([
      `GRANT USAGE ON *.* TO \`${a.mig.user}\`@\`%\``,
      `GRANT ALL PRIVILEGES ON \`${a.schema}\`.* TO \`${a.mig.user}\`@\`%\``,
    ]);
  });

  it('lets the app account do its work on its own schema', async () => {
    const [res] = await appA.query('INSERT INTO users (name, email) VALUES (?, ?)', ['a-user', 'a@example.com']);
    await appA.query('UPDATE users SET name = ? WHERE id = ?', ['a-user-renamed', res.insertId]);
    const [rows] = await appA.query('SELECT name FROM users WHERE id = ?', [res.insertId]);
    expect(rows).toEqual([{ name: 'a-user-renamed' }]);
    await appA.query('DELETE FROM users WHERE id = ?', [res.insertId]);
  });
});

describe("instance A's app account against instance B", () => {
  it('the row it must not reach is there: every denial below is a denial, not an absence', async () => {
    const [rows] = await admin.query(`SELECT name FROM ${mysql.escapeId(b.schema)}.users WHERE name = ?`, [SECRET]);
    expect(rows).toEqual([{ name: SECRET }]);
  });

  // The 2026-08-24 proof's eleven shapes, the plan's seventeen, and the
  // statements that reach past a schema: the server's files, its accounts,
  // other sessions. Each with the error MySQL 8.4.11 answers.
  it.each([
    ['a schema-qualified SELECT', 'SELECT * FROM {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['a backtick-quoted SELECT', 'SELECT * FROM {B}.`users`', ER_TABLEACCESS_DENIED_ERROR],
    ['an INSERT', "INSERT INTO {B}.users (name, email) VALUES ('x', 'x@example.com')", ER_TABLEACCESS_DENIED_ERROR],
    ['an UPDATE', "UPDATE {B}.users SET name = 'x'", ER_TABLEACCESS_DENIED_ERROR],
    ['a DELETE', 'DELETE FROM {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['a REPLACE', "REPLACE INTO {B}.users (id, name, email) VALUES (1, 'x', 'x@example.com')", ER_TABLEACCESS_DENIED_ERROR],
    ['a JOIN of its own logs with B logs', 'SELECT * FROM {A}.logs l JOIN {B}.logs m ON m.id = l.id', ER_TABLEACCESS_DENIED_ERROR],
    ['a comma join', 'SELECT * FROM {A}.logs, {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['a subquery', 'SELECT (SELECT name FROM {B}.users LIMIT 1) AS n', ER_TABLEACCESS_DENIED_ERROR],
    ['a CTE named after a real table', 'WITH users AS (SELECT * FROM {B}.users) SELECT * FROM users', ER_TABLEACCESS_DENIED_ERROR],
    ['a UNION', 'SELECT id FROM {A}.users UNION SELECT id FROM {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['a TABLE statement', 'TABLE {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['a CREATE VIEW over B', 'CREATE VIEW {A}.v AS SELECT * FROM {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['a CREATE TABLE ... SELECT from B', 'CREATE TABLE {A}.x SELECT * FROM {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['USE', 'USE {B}', ER_DBACCESS_DENIED_ERROR],
    ['SHOW TABLES FROM', 'SHOW TABLES FROM {B}', ER_DBACCESS_DENIED_ERROR],
    ['SHOW TABLE STATUS FROM', 'SHOW TABLE STATUS FROM {B}', ER_DBACCESS_DENIED_ERROR],
    ['SHOW CREATE TABLE', 'SHOW CREATE TABLE {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['DESCRIBE', 'DESCRIBE {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['SHOW INDEX', 'SHOW INDEX FROM {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['HANDLER ... OPEN', 'HANDLER {B}.users OPEN', ER_TABLEACCESS_DENIED_ERROR],
    ['LOCK TABLES', 'LOCK TABLES {B}.users READ', ER_DBACCESS_DENIED_ERROR],
    ['a RENAME into B', 'RENAME TABLE {A}.logs TO {B}.logs_taken', ER_TABLEACCESS_DENIED_ERROR],
    ['DROP DATABASE', 'DROP DATABASE {B}', ER_DBACCESS_DENIED_ERROR],
    ['CALL of a routine in B', 'CALL {B}.probe()', ER_PROCACCESS_DENIED_ERROR],
    ['PREPARE of a statement on B', "PREPARE s FROM 'SELECT * FROM {B}.users'", ER_TABLEACCESS_DENIED_ERROR],
    ['a GRANT on B to itself', "GRANT SELECT ON {B}.* TO CURRENT_USER()", ER_DBACCESS_DENIED_ERROR],
    ['a GRANT on its own schema to B', 'GRANT SELECT ON {A}.* TO {B_APP}', ER_DBACCESS_DENIED_ERROR],
    ["reading B's grants", 'SHOW GRANTS FOR {B_APP}', ER_TABLEACCESS_DENIED_ERROR],
    ['mysql.user', 'SELECT * FROM mysql.user', ER_TABLEACCESS_DENIED_ERROR],
    ['CREATE USER', "CREATE USER 'c2_it_nobody'@'%'", ER_SPECIFIC_ACCESS_DENIED_ERROR],
    ['SET GLOBAL', 'SET GLOBAL max_connections = 10', ER_SPECIFIC_ACCESS_DENIED_ERROR],
    ['KILL of B\'s connection', 'KILL {B_CONN}', ER_KILL_DENIED_ERROR],
    ['KILL QUERY on B\'s connection', 'KILL QUERY {B_CONN}', ER_KILL_DENIED_ERROR],
    ["other sessions' statements", 'SELECT * FROM performance_schema.events_statements_history', ER_TABLEACCESS_DENIED_ERROR],
    ["other sessions' threads", 'SELECT * FROM performance_schema.threads', ER_TABLEACCESS_DENIED_ERROR],
    ["other sessions' locks", 'SELECT * FROM performance_schema.data_locks', ER_TABLEACCESS_DENIED_ERROR],
    ["other sessions' transactions", 'SELECT * FROM information_schema.INNODB_TRX', ER_SPECIFIC_ACCESS_DENIED_ERROR],
    ['the sys schema', 'SELECT * FROM sys.processlist', ER_TABLEACCESS_DENIED_ERROR],
    ['SELECT ... INTO OUTFILE', "SELECT 1 INTO OUTFILE '/var/lib/mysql-files/c2-it-probe'", ER_SPECIFIC_ACCESS_DENIED_ERROR],
    ['LOAD DATA INFILE', "LOAD DATA INFILE '/var/lib/mysql-files/c2-it-probe' INTO TABLE {A}.users", ER_ACCESS_DENIED_ERROR],
    // No DDL even on its own schema: a compromised app cannot reshape it.
    ['CREATE TABLE on its own schema', 'CREATE TABLE {A}.x (id INT)', ER_TABLEACCESS_DENIED_ERROR],
    ['ALTER TABLE on its own schema', 'ALTER TABLE {A}.users ADD COLUMN x INT', ER_TABLEACCESS_DENIED_ERROR],
    ['CREATE TEMPORARY TABLE', 'CREATE TEMPORARY TABLE {A}.t (id INT)', ER_DBACCESS_DENIED_ERROR],
  ])('%s fails with the privilege error', async (_name, sql, errno) => {
    expect(await errnoOf(appA, sql)).toBe(errno);
  });

  it('SHOW DATABASES lists its own schema and the two system schemas every account sees', async () => {
    const [rows] = await appA.query('SHOW DATABASES');
    expect(rows.map((row) => row.Database).sort()).toEqual(
      ['information_schema', 'performance_schema', a.schema].sort()
    );
  });

  it("information_schema has no row about B's tables, columns or routines", async () => {
    for (const [table, column] of [['TABLES', 'TABLE_SCHEMA'], ['COLUMNS', 'TABLE_SCHEMA'],
      ['ROUTINES', 'ROUTINE_SCHEMA'], ['SCHEMATA', 'SCHEMA_NAME']]) {
      const [[{ n }]] = await appA.query(`SELECT COUNT(*) AS n FROM information_schema.${table} WHERE ${column} = ?`, [b.schema]);
      expect(n, table).toBe(0);
    }
    // Non-vacuity: the same question about its own schema has answers.
    const [[{ n }]] = await appA.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [a.schema]);
    expect(n).toBeGreaterThan(0);
  });

  // Every system view the app account can read, searched for B's schema
  // name. MySQL lists every file-per-table tablespace to every account, so
  // one view does name B, with its tables: the recipe must say so, since it
  // is why schema names should not be customer names.
  it('the one system view that names B is TABLESPACES_EXTENSIONS, and the recipe says so', async () => {
    const [views] = await appA.query(
      'SELECT TABLE_SCHEMA AS s, TABLE_NAME AS t FROM information_schema.TABLES ' +
        "WHERE TABLE_SCHEMA IN ('information_schema', 'performance_schema')"
    );
    const read = [];
    const naming = [];
    for (const { s, t } of views) {
      let rows;
      try {
        [rows] = await appA.query(`SELECT * FROM ${mysql.escapeId(s)}.${mysql.escapeId(t)}`);
      } catch (err) {
        if ([ER_TABLEACCESS_DENIED_ERROR, ER_SPECIFIC_ACCESS_DENIED_ERROR].includes(err.errno)) continue;
        throw err;
      }
      read.push(`${s}.${t}`);
      if (JSON.stringify(rows).includes(b.schema)) naming.push(`${s}.${t}`);
    }
    // Non-vacuity: the sweep read the views that would name B if any did.
    expect(read).toEqual(expect.arrayContaining(['information_schema.TABLES', 'information_schema.SCHEMATA',
      'information_schema.COLUMNS', 'information_schema.TABLESPACES_EXTENSIONS']));
    expect(naming).toEqual(['information_schema.TABLESPACES_EXTENSIONS']);

    const [rows] = await appA.query(
      'SELECT TABLESPACE_NAME AS name FROM information_schema.TABLESPACES_EXTENSIONS WHERE TABLESPACE_NAME LIKE ?',
      [`${b.schema}/%`]
    );
    expect(rows.map((row) => row.name)).toContain(`${b.schema}/users`);
    expect(recipeSection()).toContain('TABLESPACES_EXTENSIONS');
  });

  it('sees only its own connections in the process list', async () => {
    const [[{ bConn }]] = await appB.query('SELECT CONNECTION_ID() AS bConn');
    for (const sql of ['SELECT ID, USER FROM information_schema.PROCESSLIST', 'SELECT ID, USER FROM performance_schema.processlist']) {
      const [rows] = await appA.query(sql);
      expect(rows.length, sql).toBeGreaterThan(0);
      expect(rows.every((row) => row.USER === a.app.user), sql).toBe(true);
      expect(rows.some((row) => row.ID === bConn), sql).toBe(false);
    }
  });

  it('LOAD_FILE reads nothing', async () => {
    const [[{ f }]] = await appA.query("SELECT LOAD_FILE('/etc/hostname') AS f");
    expect(f).toBeNull();
  });
});

describe("instance A's migration account against instance B", () => {
  it.each([
    ['a SELECT', 'SELECT * FROM {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['a CREATE TABLE', 'CREATE TABLE {B}.x (id INT)', ER_TABLEACCESS_DENIED_ERROR],
    ['an ALTER TABLE', 'ALTER TABLE {B}.users ADD COLUMN x INT', ER_TABLEACCESS_DENIED_ERROR],
    ['a DROP TABLE', 'DROP TABLE {B}.users', ER_TABLEACCESS_DENIED_ERROR],
    ['DROP DATABASE', 'DROP DATABASE {B}', ER_DBACCESS_DENIED_ERROR],
    ['a GRANT on its own schema to B (no GRANT OPTION)', 'GRANT SELECT ON {A}.* TO {B_APP}', ER_DBACCESS_DENIED_ERROR],
    ['CREATE USER', "CREATE USER 'c2_it_nobody'@'%'", ER_SPECIFIC_ACCESS_DENIED_ERROR],
    ['SET GLOBAL', 'SET GLOBAL max_connections = 10', ER_SPECIFIC_ACCESS_DENIED_ERROR],
    ['KILL of B\'s connection', 'KILL {B_CONN}', ER_KILL_DENIED_ERROR],
    ['SELECT ... INTO OUTFILE', "SELECT 1 INTO OUTFILE '/var/lib/mysql-files/c2-it-probe'", ER_SPECIFIC_ACCESS_DENIED_ERROR],
  ])('%s fails with the privilege error', async (_name, sql, errno) => {
    expect(await errnoOf(migA, sql)).toBe(errno);
  });

  it('SHOW DATABASES lists its own schema and the two system schemas', async () => {
    const [rows] = await migA.query('SHOW DATABASES');
    expect(rows.map((row) => row.Database).sort()).toEqual(
      ['information_schema', 'performance_schema', a.schema].sort()
    );
  });
});

describe('connections', () => {
  it("app A's connection cap stops it at its limit while app B still connects", async () => {
    const [[{ limit }]] = await admin.query(
      "SELECT max_user_connections AS `limit` FROM mysql.user WHERE User = ? AND Host = '%'", [a.app.user]
    );
    // Room for the default pool of ten, the instance lock's own connection,
    // and the one the lock opens to take itself back.
    expect(limit).toBeGreaterThanOrEqual(12);
    const extra = [];
    let refused = null;
    try {
      // appA already holds one; keep opening until MySQL says no.
      while (refused === null && extra.length <= limit) {
        try {
          extra.push(await connectAs(a.app, a.schema));
        } catch (err) {
          refused = err.errno;
        }
      }
      expect(refused).toBe(ER_USER_LIMIT_REACHED);
      expect(extra.length).toBeLessThan(limit);

      const other = await connectAs(b.app, b.schema);
      await other.end();
    } finally {
      for (const conn of extra) await conn.end();
    }
  });

  it("each instance's app account holds its own single-writer lock, at the same time", async () => {
    const lockA = holdLock({ DB_USER: a.app.user, DB_PASS: a.app.password, DB_NAME: a.schema });
    const lockB = holdLock({ DB_USER: b.app.user, DB_PASS: b.app.password, DB_NAME: b.schema });
    const [heldA, heldB] = await Promise.all([lockA.outcome, lockB.outcome]);

    expect(heldA.held, heldA.stderr).toBe(true);
    expect(heldB.held, heldB.stderr).toBe(true);
    expect(heldA.connectionId).not.toBe(heldB.connectionId);
    // And each is the lock of its own schema: a second holder on A is refused.
    const again = await holdLock({ DB_USER: a.app.user, DB_PASS: a.app.password, DB_NAME: a.schema }).outcome;
    expect(again.held).toBe(false);
    expect(again.stderr).toContain(`MySQL connection ${heldA.connectionId}`);
  });
});

describe('why the recipe names schemas with letters and digits only', () => {
  it('a database-level grant reads _ as a wildcard, so it would reach a lookalike schema', async () => {
    const [[{ partial }]] = await admin.query('SELECT @@partial_revokes AS partial');
    expect(partial, 'this demonstration assumes MySQL\'s default, partial_revokes OFF').toBe(0);

    const hex = randomBytes(6).toString('hex');
    const named = `${SCHEMA_PREFIX}${hex}_x`;
    const lookalike = `${SCHEMA_PREFIX}${hex}zx`;
    const user = `${SCHEMA_PREFIX}${hex}_wild`;
    const password = randomBytes(18).toString('base64url');
    try {
      for (const schema of [named, lookalike]) {
        await admin.query(`CREATE DATABASE ${mysql.escapeId(schema)}`);
        await admin.query(`CREATE TABLE ${mysql.escapeId(schema)}.t (v VARCHAR(20))`);
      }
      await admin.query(`INSERT INTO ${mysql.escapeId(lookalike)}.t VALUES ('lookalike')`);
      await admin.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [user, password]);
      await admin.query(`GRANT SELECT ON ${mysql.escapeId(named)}.* TO ?@'%'`, [user]);

      const conn = await connectAs({ user, password }, named);
      try {
        const [rows] = await conn.query(`SELECT v FROM ${mysql.escapeId(lookalike)}.t`);
        expect(rows).toEqual([{ v: 'lookalike' }]);
      } finally {
        await conn.end();
      }
    } finally {
      await dropSchema(admin, named);
      await dropSchema(admin, lookalike);
      await dropUser(admin, user);
    }
  });
});

describe('the global teardown', () => {
  // It drops on whatever server IT_DB_HOST names, which may be a developer's
  // own, so a schema of theirs that merely starts like ours must survive it.
  it('recognises the names this project mints and nothing that only starts like them', () => {
    expect(isThrowawaySchema(a.schema)).toBe(true);
    expect(isThrowawaySchema(b.schema)).toBe(true);
    expect(isThrowawaySchema(throwawaySchemaName())).toBe(true);
    for (const name of ['c2items', 'c2itest', 'c2it', 'c2it0123456789ab', `${a.schema}x`, `${a.schema}_x`]) {
      expect(isThrowawaySchema(name), name).toBe(false);
    }
  });
});
