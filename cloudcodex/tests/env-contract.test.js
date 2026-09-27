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

  it('documents every variable in the repository .env.example', () => {
    const example = readFileSync(path.join(REPO, '.env.example'), 'utf8');
    const undocumented = ENV_CONTRACT
      .map((e) => e.name)
      .filter((name) => !new RegExp(`^#?\\s*${name}=`, 'm').test(example));
    expect(undocumented).toEqual([]);
  });

  it('is data only: no import, no export but ENV_CONTRACT, no require', () => {
    const source = readFileSync(path.join(APP, 'env-contract.js'), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source.match(/^export\b.*$/gm)).toEqual(['export const ENV_CONTRACT = [']);
  });
});
