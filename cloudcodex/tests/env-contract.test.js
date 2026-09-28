/**
 * Pins env-contract.js to every environment variable the server actually reads
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { ENV_CONTRACT } from '../env-contract.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(APP, '..');

// What the scan skips, by directory name at any depth. tests/ is excluded
// because a test sets variables rather than reading them as configuration;
// the rest are generated or third-party. Dot-directories are skipped too.
const SKIP_DIRS = new Set(['tests', 'vendor', 'node_modules', 'dist', 'coverage']);
const SOURCE_EXT = /\.(js|jsx|mjs|cjs)$/;

// A bare `process.env` (passed whole, destructured, or `env` imported from
// node:process) hides which names it reads, so the scan refuses it unless it
// is listed here with the names it stands for. An entry that no longer
// matches a bare use also fails, so this list cannot go stale silently.
const BARE_ENV_ALLOWED = {
  // main() hands process.env to resolveDbConfig(env), which reads these four;
  // tests pass it a fake env, which is why it takes a parameter.
  'scripts/migrate.js': ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'],
};

const KINDS = ['required', 'required-in-production', 'default', 'optional'];

function sourceFiles(dir, rel = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(path.join(dir, entry.name), relPath));
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(relPath);
    }
  }
  return out;
}

const isProcessEnv = (node) =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.property.type === 'Identifier' &&
  node.property.name === 'env' &&
  ((node.object.type === 'Identifier' && node.object.name === 'process') ||
    (node.object.type === 'MemberExpression' && !node.object.computed &&
      node.object.property.type === 'Identifier' && node.object.property.name === 'process'));

/**
 * Parse one file with ESLint's own parser and report every process.env use:
 * literal reads by name, computed reads, and bare uses. A parse failure is
 * reported rather than skipped, because a file the scan cannot read is a
 * file whose variables it would silently miss.
 */
function scanSource(code, filename) {
  const found = { names: [], computed: [], bare: [], fatal: [] };
  const scanRule = {
    create() {
      return {
        MemberExpression(node) {
          if (!isProcessEnv(node)) return;
          const parent = node.parent;
          const line = node.loc.start.line;
          if (parent?.type === 'MemberExpression' && parent.object === node) {
            const prop = parent.property;
            if (!parent.computed) found.names.push(prop.name);
            else if (prop.type === 'Literal' && typeof prop.value === 'string') found.names.push(prop.value);
            else if (prop.type === 'TemplateLiteral' && prop.expressions.length === 0) {
              found.names.push(prop.quasis[0].value.cooked);
            } else found.computed.push(`${filename}:${line}`);
          } else {
            found.bare.push(`${filename}:${line}`);
          }
        },
        ImportDeclaration(node) {
          if (node.source.value !== 'process' && node.source.value !== 'node:process') return;
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'env') {
              found.bare.push(`${filename}:${node.loc.start.line}`);
            }
          }
        },
      };
    },
  };
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(code, [{
    files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: filename.endsWith('.cjs') ? 'commonjs' : 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // The source's eslint-disable comments are for the real lint config, so
    // here they are unused (and name rules this config does not load).
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { contract: { rules: { scan: scanRule } } },
    rules: { 'contract/scan': 'error' },
  }], { filename });
  // A parse error is fatal; "no matching configuration" is a message with no
  // rule. Either means the file was not read. A message that names a rule is
  // an eslint-disable comment naming a rule this config does not load.
  for (const m of messages) {
    if (m.fatal || m.ruleId === null) found.fatal.push(`${filename}:${m.line} ${m.message}`);
  }
  return found;
}

function scanApp() {
  const result = { names: new Set(), computed: [], bare: {}, fatal: [], files: 0 };
  for (const rel of sourceFiles(APP)) {
    const found = scanSource(readFileSync(path.join(APP, rel), 'utf8'), rel);
    result.files += 1;
    found.names.forEach((n) => result.names.add(n));
    result.computed.push(...found.computed);
    result.fatal.push(...found.fatal);
    if (found.bare.length) result.bare[rel] = found.bare;
  }
  return result;
}

/** Every structural problem with a contract, as sentences; empty when sound. */
function contractProblems(contract) {
  const problems = [];
  const names = contract.map((e) => e.name);
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name)) problems.push(`${name} has two entries`);
    seen.add(name);
  }
  for (const e of contract) {
    if (typeof e.name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(e.name)) problems.push(`bad name ${e.name}`);
    if (!KINDS.includes(e.kind)) problems.push(`${e.name} has kind ${e.kind}`);
    if (typeof e.perInstance !== 'boolean') problems.push(`${e.name} has no boolean perInstance`);
    if (typeof e.why !== 'string' || e.why.trim() === '') problems.push(`${e.name} has no why`);
    if (e.kind === 'default' && typeof e.default !== 'string') problems.push(`${e.name} is a default with no default string`);
    if (e.kind !== 'default' && 'default' in e) problems.push(`${e.name} carries a default but is ${e.kind}`);
    if ('requiredWith' in e) {
      if (e.kind !== 'optional') problems.push(`${e.name} has requiredWith but is ${e.kind}`);
      if (e.requiredWith === e.name || !names.includes(e.requiredWith)) {
        problems.push(`${e.name} requiredWith ${e.requiredWith} names no other entry`);
      }
    }
    const extra = Object.keys(e).filter((k) => !['name', 'kind', 'default', 'requiredWith', 'perInstance', 'why'].includes(k));
    if (extra.length) problems.push(`${e.name} has unknown fields ${extra.join(', ')}`);
  }
  return problems;
}

/**
 * The rows of the Environment Variables table in docs/getting-started.md, as
 * name -> { description, value } for every row whose first cell is one
 * backticked name.
 */
function envTableRows(markdown) {
  const section = markdown.split(/^## /m).find((s) => s.startsWith('Environment Variables'));
  const rows = new Map();
  if (!section) return rows;
  for (const line of section.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const name = cells[0]?.match(/^`([A-Z][A-Z0-9_]*)`$/);
    if (name && cells.length === 3) rows.set(name[1], { description: cells[1], value: cells[2] });
  }
  return rows;
}

/**
 * Every way the table disagrees with a contract, as sentences: an entry with
 * no row, and a row whose Default column contradicts the entry's kind.
 */
function envTableProblems(contract, markdown) {
  const rows = envTableRows(markdown);
  const problems = [];
  for (const e of contract) {
    const row = rows.get(e.name);
    if (!row) { problems.push(`${e.name} has no row`); continue; }
    if (e.kind === 'required' && !/required/i.test(row.value)) {
      problems.push(`${e.name} is required but its row says ${row.value}`);
    }
    if (e.kind === 'required-in-production' && !/required in production/i.test(`${row.description} ${row.value}`)) {
      problems.push(`${e.name} is required in production but its row does not say so`);
    }
    if (e.kind === 'default' && !row.value.includes(`\`${e.default}\``)) {
      problems.push(`${e.name} defaults to ${e.default} but its row says ${row.value}`);
    }
    if (e.kind === 'optional' && /\brequired\b/i.test(row.value)) {
      problems.push(`${e.name} is optional but its row says ${row.value}`);
    }
  }
  return problems;
}

describe('the scanner (non-vacuity)', () => {
  it('sees dotted, bracketed and template reads, and flags computed and bare uses', () => {
    const found = scanSource([
      "const a = process.env.ALPHA;",
      "const b = process.env['BETA'];",
      'const c = process.env[`GAMMA`];',
      'const d = process.env[key];',
      'const e = globalThis.process.env.DELTA;',
      'const { EPSILON } = process.env;',
      'use(process.env);',
      "import { env } from 'node:process';",
      '// process.env.IN_A_COMMENT is not a read',
      "const s = 'process.env.IN_A_STRING';",
      'const j = <div>{process.env.IN_JSX}</div>;',
    ].join('\n'), 'fixture.jsx');
    expect(found.fatal).toEqual([]);
    expect(found.names.sort()).toEqual(['ALPHA', 'BETA', 'DELTA', 'GAMMA', 'IN_JSX']);
    expect(found.computed).toEqual(['fixture.jsx:4']);
    expect(found.bare).toEqual(['fixture.jsx:6', 'fixture.jsx:7', 'fixture.jsx:8']);
  });

  it('reports a file it cannot parse, or cannot match, instead of skipping it', () => {
    expect(scanSource('const = ;', 'broken.js').fatal).toHaveLength(1);
    expect(scanSource('const a = process.env.A;', 'unmatched.ts').fatal).toHaveLength(1);
  });

  it('the getting-started table check catches each defect it claims to', () => {
    const contract = [
      { name: 'A_REQ', kind: 'required', perInstance: false, why: 'x' },
      { name: 'B_PROD', kind: 'required-in-production', perInstance: false, why: 'x' },
      { name: 'C_DEF', kind: 'default', default: '10', perInstance: false, why: 'x' },
      { name: 'D_OPT', kind: 'optional', perInstance: false, why: 'x' },
      { name: 'E_MISSING', kind: 'optional', perInstance: false, why: 'x' },
    ];
    const table = [
      '## Environment Variables',
      '',
      '| Variable | Description | Default |',
      '| --- | --- | --- |',
      '| `A_REQ` | a | `admin` |',
      '| `B_PROD` | b | `http://localhost:3000` in development |',
      '| `C_DEF` | c | `100` |',
      '| `D_OPT` | d | (required) |',
      '',
      '## Next',
      '| `E_MISSING` | outside the section | unset |',
    ].join('\n');
    expect(envTableProblems(contract, table)).toEqual([
      'A_REQ is required but its row says `admin`',
      'B_PROD is required in production but its row does not say so',
      'C_DEF defaults to 10 but its row says `100`',
      'D_OPT is optional but its row says (required)',
      'E_MISSING has no row',
    ]);
  });

  it('the contract checks catch each defect they claim to', () => {
    const bad = [
      { name: 'A', kind: 'sometimes', perInstance: false, why: 'x' },
      { name: 'B', kind: 'default', perInstance: 'no', why: 'x' },
      { name: 'C', kind: 'optional', perInstance: false, why: '', requiredWith: 'C' },
      { name: 'D', kind: 'required', perInstance: false, why: 'x', default: '1' },
      { name: 'E', kind: 'optional', perInstance: false, why: 'x', requiredWith: 'NOPE' },
      { name: 'E', kind: 'optional', perInstance: false, why: 'x', extra: 1 },
    ];
    const problems = contractProblems(bad).join('\n');
    expect(problems).toMatch(/A has kind sometimes/);
    expect(problems).toMatch(/B has no boolean perInstance/);
    expect(problems).toMatch(/B is a default with no default string/);
    expect(problems).toMatch(/C has no why/);
    expect(problems).toMatch(/C requiredWith C names no other entry/);
    expect(problems).toMatch(/D carries a default but is required/);
    expect(problems).toMatch(/E requiredWith NOPE names no other entry/);
    expect(problems).toMatch(/E has two entries/);
    expect(problems).toMatch(/E has unknown fields extra/);
  });
});

describe('env-contract.js', () => {
  const scan = scanApp();

  it('scans the application (non-vacuity)', () => {
    expect(scan.fatal).toEqual([]);
    expect(scan.files).toBeGreaterThan(50);
    expect(scan.names).toContain('DB_USER');
    expect(scan.names).toContain('APP_URL');
  });

  it('has an entry for every variable the server reads, and none it does not', () => {
    const read = new Set(scan.names);
    for (const names of Object.values(BARE_ENV_ALLOWED)) names.forEach((n) => read.add(n));
    const declared = new Set(ENV_CONTRACT.map((e) => e.name));
    const missing = [...read].filter((n) => !declared.has(n)).sort();
    const unread = [...declared].filter((n) => !read.has(n)).sort();
    expect({ missing, unread }).toEqual({ missing: [], unread: [] });
  });

  it('reads no variable by a computed key', () => {
    expect(scan.computed).toEqual([]);
  });

  it('has a bare process.env use only where the allowlist names it', () => {
    expect(Object.keys(scan.bare).sort()).toEqual(Object.keys(BARE_ENV_ALLOWED).sort());
    for (const [file, uses] of Object.entries(scan.bare)) {
      expect(uses, `${file} ${uses.join(', ')}`).toHaveLength(1);
    }
  });

  it('is structurally sound: kinds, defaults, requiredWith, perInstance and why', () => {
    expect(contractProblems(ENV_CONTRACT)).toEqual([]);
  });

  // Each stated default is proven against the code by a test elsewhere, which
  // reads the expected value through contractDefault('<NAME>'). A new default
  // entry fails here until such a test exists, and so does a listed file that
  // stops calling it.
  const DEFAULT_PROVEN_IN = {
    DB_HOST: 'tests/mysql_connect.test.js',
    DB_NAME: 'tests/mysql_connect.test.js',
    DB_POOL_SIZE: 'tests/mysql_connect.test.js',
    PORT: 'tests/server.test.js',
    TRUST_PROXY: 'tests/app.test.js',
    C2_INSTANCE_LOCK: 'tests/services/instance-lock.test.js',
    LEGACY_SESSION_COOKIE: 'tests/services/session-cookie.test.js',
    SMTP_PORT: 'tests/services/email.test.js',
    SMTP_FROM: 'tests/services/email.test.js',
  };

  it('has a test proving every stated default against the code', () => {
    const defaults = ENV_CONTRACT.filter((e) => e.kind === 'default').map((e) => e.name).sort();
    expect(Object.keys(DEFAULT_PROVEN_IN).sort()).toEqual(defaults);
    for (const [name, file] of Object.entries(DEFAULT_PROVEN_IN)) {
      const source = readFileSync(path.join(APP, file), 'utf8');
      expect(source, `${file} proves ${name}`).toContain(`contractDefault('${name}')`);
    }
  });

  it('documents every variable in the repository .env.example', () => {
    const example = readFileSync(path.join(REPO, '.env.example'), 'utf8');
    const undocumented = ENV_CONTRACT
      .map((e) => e.name)
      .filter((name) => !new RegExp(`^#?\\s*${name}=`, 'm').test(example));
    expect(undocumented).toEqual([]);
  });

  // The table is where an operator reads what to set, so an entry the table
  // lacks, or a row that says the opposite of the entry, misleads a first
  // install as surely as a missing .env.example line.
  it('has a row in docs/getting-started.md for every variable, agreeing with its kind', () => {
    const markdown = readFileSync(path.join(REPO, 'docs', 'getting-started.md'), 'utf8');
    expect(envTableRows(markdown).get('DB_USER')).toBeDefined();
    expect(envTableProblems(ENV_CONTRACT, markdown)).toEqual([]);
  });

  it('is data only: no import, no export but ENV_CONTRACT, no require', () => {
    const source = readFileSync(path.join(APP, 'env-contract.js'), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source.match(/^export\b.*$/gm)).toEqual(['export const ENV_CONTRACT = [']);
  });
});
