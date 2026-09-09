/**
 * Runs the shipped /api/users/search scoping query against the fixture in this
 * directory. The query text is extracted verbatim from cloudcodex/routes/auth.js
 * rather than retyped, so an edit to the route is what this checks.
 *
 * Usage, from the repo root, with the container from README.md running:
 *   node docs/research/users-search-scope-2026-09-08/verify.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const routeFile = path.join(repoRoot, 'cloudcodex', 'routes', 'auth.js');

// mysql2 lives in cloudcodex/node_modules, so resolve it from there.
const require = createRequire(path.join(repoRoot, 'cloudcodex', 'package.json'));
const mysql = require('mysql2/promise');

const src = fs.readFileSync(routeFile, 'utf8');
const match = src.match(/`(WITH my_workspaces AS \([\s\S]*?ORDER BY u\.name ASC LIMIT 10)`/);
if (!match) {
  console.error('Could not find the scoping query in', routeFile);
  process.exit(1);
}
const SQL = match[1];
const placeholders = (SQL.match(/\?/g) || []).length;

const conn = await mysql.createConnection({
  host: '127.0.0.1', port: 13306, user: 'root', password: 'verify', database: 'c2search',
});

async function search(callerId, q) {
  const pattern = `%${q}%`;
  // The same param list routes/auth.js binds.
  const params = [callerId, callerId, pattern, pattern, callerId, callerId, callerId];
  if (params.length !== placeholders) {
    throw new Error(`param/placeholder mismatch: ${params.length} params, ${placeholders} placeholders`);
  }
  const [rows] = await conn.execute(SQL, params);
  return rows.map(r => r.name).sort();
}

const CASES = [
  ['alice (owns W1, in no squad) finds the SSO account', 1, 'eri', ['erin']],
  ['dan (squad admin in W1) finds the SSO account', 4, 'eri', ['erin']],
  ['bob (ordinary member, no flags) does not', 2, 'eri', []],
  ['frank (ordinary member of W2) does not', 5, 'eri', []],
  ['bob sees his own workspace owner', 2, 'ali', ['alice']],
  ["frank does not see another tenant's owner", 5, 'ali', []],
  ['bob does not see an out-of-tenant squad-less owner', 2, 'gra', []],
  ['dan, who can invite, does see her', 4, 'gra', ['grace']],
  ['bob sees himself', 2, 'bob', ['bob']],
  ['bob sees a squad-mate', 2, 'dan', ['dan']],
  ['frank does not see a W1 member', 5, 'dan', []],
  ['bob does not see the platform admin', 2, 'roo', []],
];

console.error(`placeholders in the shipped query: ${placeholders}`);
let bad = 0;
for (const [label, caller, q, expected] of CASES) {
  const got = await search(caller, q);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) bad++;
  console.error(`${ok ? 'PASS' : 'FAIL'}  ${label} q="${q}" -> ${JSON.stringify(got)} (expected ${JSON.stringify(expected)})`);
}
await conn.end();
console.error(bad === 0 ? 'ALL CASES AS EXPECTED' : `${bad} CASE(S) UNEXPECTED`);
process.exit(bad === 0 ? 0 : 1);
