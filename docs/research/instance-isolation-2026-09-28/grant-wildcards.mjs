/**
 * Why the shared-server recipe names schemas with letters and digits only
 *
 * Grants SELECT on a schema whose name holds an underscore, three ways (plain,
 * backslash-escaped, and escaped again with partial_revokes on), and reports
 * which accounts reach a lookalike schema and which lose their own. Needs a
 * scratch MySQL 8.4 it may reconfigure: it sets partial_revokes ON and back
 * OFF. From the repo root, with cloudcodex/node_modules installed:
 *
 *   IT_DB_HOST=<server> IT_DB_ROOT_PASSWORD=<pw> node docs/research/instance-isolation-2026-09-28/grant-wildcards.mjs
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import mysql from '../../../cloudcodex/node_modules/mysql2/promise.js';

const host = process.env.IT_DB_HOST ?? '127.0.0.1';
const root = await mysql.createConnection({ host, user: 'root', password: process.env.IT_DB_ROOT_PASSWORD });

const attempt = async (conn, sql) => {
  try {
    const [rows] = await conn.query(sql);
    return `rows ${JSON.stringify(rows)}`;
  } catch (err) {
    return `error ${err.errno} ${err.code}`;
  }
};

async function reach(user, password) {
  const conn = await mysql.createConnection({ host, user, password });
  try {
    for (const schema of ['w_a', 'wXa']) {
      process.stdout.write(`  ${user} SELECT * FROM ${schema}.t -> ${await attempt(conn, `SELECT * FROM ${schema}.t`)}\n`);
    }
  } finally {
    await conn.end();
  }
}

const [[{ version }]] = await root.query('SELECT VERSION() AS version');
process.stdout.write(`server ${version}\n`);
try {
  for (const schema of ['w_a', 'wXa']) {
    await root.query(`CREATE DATABASE ${schema}`);
    await root.query(`CREATE TABLE ${schema}.t (v VARCHAR(20))`);
    await root.query(`INSERT INTO ${schema}.t VALUES ('${schema}')`);
  }
  await root.query("CREATE USER 'w_plain'@'%' IDENTIFIED BY 'plain-pw'");
  await root.query("GRANT SELECT ON `w_a`.* TO 'w_plain'@'%'");
  await root.query("CREATE USER 'w_escaped'@'%' IDENTIFIED BY 'escaped-pw'");
  await root.query("GRANT SELECT ON `w\\_a`.* TO 'w_escaped'@'%'");

  process.stdout.write('partial_revokes OFF (the default):\n');
  await reach('w_plain', 'plain-pw');
  await reach('w_escaped', 'escaped-pw');

  await root.query('SET GLOBAL partial_revokes = ON');
  await root.query("CREATE USER 'w_escaped_on'@'%' IDENTIFIED BY 'escaped-on-pw'");
  await root.query("GRANT SELECT ON `w\\_a`.* TO 'w_escaped_on'@'%'");
  process.stdout.write('partial_revokes ON:\n');
  await reach('w_plain', 'plain-pw');
  await reach('w_escaped', 'escaped-pw');
  await reach('w_escaped_on', 'escaped-on-pw');
} finally {
  await root.query('SET GLOBAL partial_revokes = OFF');
  await root.query("DROP USER IF EXISTS 'w_plain'@'%', 'w_escaped'@'%', 'w_escaped_on'@'%'");
  await root.query('DROP DATABASE IF EXISTS w_a');
  await root.query('DROP DATABASE IF EXISTS wXa');
  await root.end();
}
