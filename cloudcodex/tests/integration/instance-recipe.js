/**
 * The shared-server recipe from docs/deployment.md, run for real
 *
 * The recipe an operator follows to put another instance on a MySQL server is
 * the SQL block under "Several instances on one MySQL server" in
 * docs/deployment.md. This module reads that block, swaps its example names
 * and passwords for throwaway ones, and runs it, so the tests prove the recipe
 * as written rather than a copy of it that could drift.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { runMigrations, listMigrationFiles, LEGACY_BASELINE, MIGRATIONS_DIR } from '../../scripts/migrate.js';
import { UNDO_ON_INIT_SQL } from './pre-runner-state.js';
import { adminConfig, loadInitSql, queryVia, RECIPE_SCHEMA_PREFIX, SCHEMA_PREFIX } from './mysql-admin.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEPLOYMENT_MD = path.join(REPO_ROOT, 'docs', 'deployment.md');
const SECTION = '## Several instances on one MySQL server';

/** The names and passwords the documented recipe uses as its example. */
export const RECIPE_EXAMPLE = Object.freeze({
  schema: 'c2acme',
  appUser: 'c2acme_app',
  migUser: 'c2acme_mig',
  appPassword: '<app password>',
  migPassword: '<migration password>',
});

/**
 * The recipe's SQL block, verbatim: the first ```sql fence in the section.
 * @returns { String }
 */
export function recipeSql() {
  const doc = readFileSync(DEPLOYMENT_MD, 'utf8');
  const start = doc.indexOf(`\n${SECTION}\n`);
  if (start === -1) {
    throw new Error(`docs/deployment.md has no "${SECTION}" section, so there is no recipe to prove`);
  }
  const next = doc.indexOf('\n## ', start + SECTION.length + 2);
  const section = doc.slice(start, next === -1 ? undefined : next);
  const fence = section.match(/```sql\n([\s\S]*?)```/);
  if (!fence) {
    throw new Error(`the "${SECTION}" section of docs/deployment.md has no \`\`\`sql block`);
  }
  return fence[1];
}

/**
 * The recipe's statements with `instance`'s names and passwords in place of
 * the example's. Comment lines go; each statement is one string without its
 * semicolon.
 * @param { { schema: String, app: { user: String, password: String }, mig: { user: String, password: String } } } instance
 * @returns { String[] }
 */
export function recipeStatements(instance) {
  let sql = recipeSql();
  for (const name of Object.values(RECIPE_EXAMPLE)) {
    if (!sql.includes(name)) throw new Error(`the recipe no longer mentions ${name}; update RECIPE_EXAMPLE`);
  }
  // Longest first: the schema name is a prefix of both account names.
  sql = sql
    .replaceAll(RECIPE_EXAMPLE.appUser, instance.app.user)
    .replaceAll(RECIPE_EXAMPLE.migUser, instance.mig.user)
    .replaceAll(RECIPE_EXAMPLE.schema, instance.schema)
    .replaceAll(RECIPE_EXAMPLE.appPassword, instance.app.password)
    .replaceAll(RECIPE_EXAMPLE.migPassword, instance.mig.password);
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Fresh throwaway names for one instance: a letters-and-digits schema, as the
 * recipe requires, and two accounts under SCHEMA_PREFIX, which the global
 * teardown sweeps.
 */
export function newInstance() {
  const hex = randomBytes(6).toString('hex');
  const password = () => randomBytes(18).toString('base64url');
  return {
    schema: `${RECIPE_SCHEMA_PREFIX}${hex}`,
    app: { user: `${SCHEMA_PREFIX}${hex}_app`, password: password() },
    mig: { user: `${SCHEMA_PREFIX}${hex}_mig`, password: password() },
  };
}

/**
 * Run the recipe for `instance` as the admin account: the schema, both
 * accounts and their grants. Nothing is built in the schema yet.
 * @param { import('mysql2/promise').Connection } admin
 * @param { ReturnType<typeof newInstance> } instance
 */
export async function provision(admin, instance) {
  for (const statement of recipeStatements(instance)) await admin.query(statement);
}

/**
 * Drop `instance`'s schema and accounts, whatever state they are in.
 * @param { import('mysql2/promise').Connection } admin
 * @param { ReturnType<typeof newInstance> } instance
 */
export async function unprovision(admin, instance) {
  await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(instance.schema)}`);
  await admin.query(`DROP USER IF EXISTS ?@'%', ?@'%'`, [instance.app.user, instance.mig.user]);
}

/**
 * A connection as one of `instance`'s accounts, on its schema.
 * @param { { user: String, password: String } } account
 * @param { String } schema
 * @param { Object } [extra] - more mysql2 options
 */
export function connectAs(account, schema, extra = {}) {
  return mysql.createConnection({
    host: adminConfig().host,
    user: account.user,
    password: account.password,
    database: schema,
    ...extra,
  });
}

/**
 * The fresh-install path, as the migration account: build init.sql into the
 * schema, then `--adopt-fresh-install`.
 * @param { ReturnType<typeof newInstance> } instance
 */
export async function buildFresh(instance) {
  const conn = await connectAs(instance.mig, instance.schema, { multipleStatements: true });
  try {
    await loadInitSql(conn);
    await runMigrations({ query: queryVia(conn), dir: MIGRATIONS_DIR, adoptFreshInstall: true, log: () => {} });
  } finally {
    await conn.end();
  }
}

/**
 * The upgrade path, as the migration account: build init.sql, take it back to
 * the pre-runner state, `--baseline`, then apply every newer migration file
 * for real. Resolves with the files the runner applied.
 * @param { ReturnType<typeof newInstance> } instance
 * @returns { Promise<String[]> }
 */
export async function buildUpgraded(instance) {
  const postBaseline = listMigrationFiles(MIGRATIONS_DIR).filter((f) => !LEGACY_BASELINE.includes(f));
  const conn = await connectAs(instance.mig, instance.schema, { multipleStatements: true });
  try {
    await loadInitSql(conn);
    const query = queryVia(conn);
    for (const filename of [...postBaseline].reverse()) await query(UNDO_ON_INIT_SQL[filename]);
    await runMigrations({ query, dir: MIGRATIONS_DIR, baseline: true, log: () => {} });
    const { applied } = await runMigrations({ query, dir: MIGRATIONS_DIR, log: () => {} });
    return applied;
  } finally {
    await conn.end();
  }
}
