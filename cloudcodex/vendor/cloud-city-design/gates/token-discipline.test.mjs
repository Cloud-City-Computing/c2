// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cloud City Computing, LLC

// node --test suite for token-discipline.mjs. Zero dependencies: run it from
// the package root with `node --test`, no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ACCENT_FILL_NAMES,
  DEFAULT_EXTENSIONS,
  collectScanTargets,
  maskComments,
  scanAccentRampPositions,
  scanRawColorLiterals,
  scanSuppressedOutlines,
} from './token-discipline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const GOLDEN = 'fx-expected.json';
const TOKEN_RULES = ['token-literal-color', 'token-accent-position', 'token-outline-suppressed'];

/** @returns {{ rule: string, file: string, line: number }[]} */
function readGolden() {
  return JSON.parse(readFileSync(join(FIXTURES, GOLDEN), 'utf8'));
}

function fixtureNames() {
  return readdirSync(FIXTURES)
    .filter((name) => name !== GOLDEN)
    .sort();
}

/** @param {string} name */
function readFixture(name) {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** @param {readonly { rule: string, file: string, line: number }[]} list */
function normalize(list) {
  return list
    .map(({ rule, file, line }) => ({ rule, file, line }))
    .sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line);
}

/** @param {string} source @param {string} file */
function allTokenFindings(source, file) {
  return [
    ...scanRawColorLiterals(source, file),
    ...scanAccentRampPositions(source, file),
    ...scanSuppressedOutlines(source, file),
  ];
}

// ---------------------------------------------------------------------------
// The golden
// ---------------------------------------------------------------------------

test('the three scanners over the fixture corpus return exactly the golden list, rule by rule', () => {
  const names = fixtureNames();
  assert.ok(names.length > 10, `only ${String(names.length)} fixture files`);
  const actual = names.flatMap((name) => allTokenFindings(readFixture(name), name));
  const golden = readGolden();
  for (const rule of TOKEN_RULES) {
    const expected = normalize(golden.filter((entry) => entry.rule === rule));
    assert.ok(expected.length > 0, `the golden has no ${rule} entry`);
    assert.deepEqual(normalize(actual.filter((finding) => finding.rule === rule)), expected, rule);
  }
});

test('every rule id, the dangling rule included, has at least one golden entry', () => {
  const rules = new Set(readGolden().map((entry) => entry.rule));
  assert.deepEqual([...rules].sort(), [...TOKEN_RULES, 'dangling-var'].sort());
});

test('the two-argument call, an empty options object and an empty extraNames list agree', () => {
  for (const name of fixtureNames()) {
    const source = readFixture(name);
    const twoArgs = scanAccentRampPositions(source, name);
    assert.deepEqual(scanAccentRampPositions(source, name, {}), twoArgs);
    assert.deepEqual(scanAccentRampPositions(source, name, { extraNames: [] }), twoArgs);
  }
});

test('every finding carries a message', () => {
  for (const name of fixtureNames()) {
    for (const finding of allTokenFindings(readFixture(name), name)) {
      assert.equal(typeof finding.message, 'string');
      assert.ok(finding.message.length > 10);
    }
  }
});

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

test('masking keeps the code-unit length and every newline where it was', () => {
  for (const name of fixtureNames()) {
    const source = readFixture(name);
    const masked = maskComments(source);
    assert.equal(masked.length, source.length, name);
    for (let index = 0; index < source.length; index += 1) {
      if (source.charCodeAt(index) === 10) assert.equal(masked.charCodeAt(index), 10, `${name} newline at ${String(index)}`);
    }
  }
});

test('an astral character before a comment does not shift the mask, and a later finding keeps its line', () => {
  const source = readFixture('fx-comments.ts');
  const masked = maskComments(source);
  assert.ok(source.includes('\u{1D49C}'), 'the corpus carries an astral character');
  assert.ok(masked.includes('\u{1D49C}'), 'the astral character is code, not comment, and survives');
  for (const hex of ['#111111', '#222222', '#333333']) assert.ok(!masked.includes(hex), `${hex} is in a comment`);
  for (const hex of ['#444444', '#555555', '#666666']) assert.ok(masked.includes(hex), `${hex} is code`);
  const lines = scanRawColorLiterals(source, 'x').map((finding) => finding.line);
  assert.deepEqual(lines, [6, 7, 8]);
});

test('a // inside a string or a quoted URL is not a comment', () => {
  const source = [
    "const u = 'a//b'; const c = '#abc';",
    'const h = "https://github.com/Cloud-City-Computing/cloud-city-design"; const d = \'#def\';',
    '',
  ].join('\n');
  assert.equal(maskComments(source), source);
  assert.deepEqual(
    scanRawColorLiterals(source, 'x').map((finding) => finding.line),
    [1, 2],
  );
});

test('line, block and HTML comments are masked, across lines too', () => {
  const source = '// #aaaaaa\n/* #bbbbbb\n#cccccc */\n<!-- #dddddd\n#eeeeee -->\n<p style="color: #fff">\n';
  const findings = scanRawColorLiterals(source, 'x');
  assert.deepEqual(
    findings.map((finding) => finding.line),
    [6],
  );
  assert.equal(maskComments('a /* b */ c'), 'a         c');
  assert.equal(maskComments('<!-- b -->c'), '          c');
});

test('an unterminated block or HTML comment masks to the end of the text', () => {
  assert.equal(maskComments('a /* #fff'), 'a        ');
  assert.equal(maskComments('a <!-- #fff'), 'a          ');
});

// ---------------------------------------------------------------------------
// Exemptions
// ---------------------------------------------------------------------------

test('an exemption marker covers its own line and the line below, in both comment forms', () => {
  const cases = [
    "const a = '#111'; // invariant-exempt: a reason",
    "// invariant-exempt: a reason\nconst a = '#111';",
    '.a { color: #111; } /* invariant-exempt: a reason */',
    '/* invariant-exempt: a reason */\n.a { color: #111; }',
  ];
  for (const source of cases) assert.deepEqual(scanRawColorLiterals(source, 'x'), [], source);
});

test('a marker covers no further than the line below it', () => {
  const source = "// invariant-exempt: a reason\nconst a = '#111';\nconst b = '#222';";
  assert.deepEqual(
    scanRawColorLiterals(source, 'x').map((finding) => finding.line),
    [3],
  );
});

test('a line-comment marker with no reason exempts nothing', () => {
  const source = "// invariant-exempt:\nconst a = '#111';\nconst b = '#222'; // invariant-exempt:";
  assert.deepEqual(
    scanRawColorLiterals(source, 'x').map((finding) => finding.line),
    [2, 3],
  );
});

test('exemptions apply to the accent and outline rules as well', () => {
  assert.deepEqual(scanAccentRampPositions('.a { color: var(--brand-blue); } /* invariant-exempt: why */', 'x'), []);
  assert.deepEqual(scanSuppressedOutlines('.a { outline: none; } /* invariant-exempt: why */', 'x'), []);
});

// ---------------------------------------------------------------------------
// Literal colours
// ---------------------------------------------------------------------------

test('every hex length and colour function is a literal, and fragments, ids and odd lengths are not', () => {
  const flagged = [
    '#abc',
    '#abcd',
    '#a1b2c3',
    '#a1b2c3d4',
    'rgb(0 0 0)',
    'rgba(0,0,0,0)',
    'hsl(0 0% 0%)',
    'hsla(0,0%,0%,0)',
    'oklch(0.5 0.1 240)',
    'oklab(0.5 0 0)',
    'lch(50 0 0)',
    'lab(50 0 0)',
    'hwb(0 0% 0%)',
    'color(srgb 0 0 0)',
    'RGB(0 0 0)',
  ];
  for (const value of flagged) assert.equal(scanRawColorLiterals(`.a { x: ${value}; }`, 'x').length, 1, value);
  const clean = ['#root', '#abcde', '#a1b2c3d4e', 'href="#abc"', "href='#abc'", 'href={#abc}', 'href = "#abc"'];
  for (const value of clean) assert.deepEqual(scanRawColorLiterals(value, 'x'), [], value);
});

// ---------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------

test('every spelling of a suppressed outline is flagged', () => {
  const flagged = [
    'outline: none;',
    'outline: 0;',
    'outline: 0px;',
    'outline: 0em;',
    'outline: 0rem;',
    'outline: 0%;',
    'outline-style: none;',
    'outline-width: 0;',
    'OUTLINE: NONE;',
    "{ outline: 'none' }",
    '{ outline: "0" }',
    '{ outline: `none` }',
    'outline: none',
  ];
  for (const value of flagged) assert.equal(scanSuppressedOutlines(`.a { ${value} }`, 'x').length, 1, value);
});

test('an outline that names a value, prose, and other properties set to none are not flagged', () => {
  const clean = [
    '.a { outline: 2px solid var(--fx-ring); }',
    '.a { outline-offset: 0; }',
    '.a { border: none; }',
    '.a { box-shadow: none; }',
    "const s = 'Never set outline: none here.';",
    '.a { outline: none 2px; }',
  ];
  for (const source of clean) assert.deepEqual(scanSuppressedOutlines(source, 'x'), [], source);
});

// ---------------------------------------------------------------------------
// Accent positions
// ---------------------------------------------------------------------------

test('every default fill shade is flagged in every watched position, and never as a background', () => {
  const positions = ['color', 'fill', 'stroke', 'outline', 'outline-color', 'box-shadow', 'border-color'];
  assert.deepEqual([...DEFAULT_ACCENT_FILL_NAMES], ['--brand-blue', '--accent-100', '--accent-200', '--accent-300', '--accent-400']);
  for (const name of DEFAULT_ACCENT_FILL_NAMES) {
    for (const position of positions) {
      const findings = scanAccentRampPositions(`.a { ${position}: 0 0 var( ${name} ); }`, 'x');
      assert.equal(findings.length, 1, `${name} in ${position}`);
      assert.equal(findings[0]?.rule, 'token-accent-position');
    }
    assert.deepEqual(scanAccentRampPositions(`.a { background-color: var(${name}); }`, 'x'), []);
    assert.deepEqual(scanAccentRampPositions(`.a { background: var(${name}); }`, 'x'), []);
  }
  for (const safe of ['--accent-500', '--accent-600', '--accent-700']) {
    assert.deepEqual(scanAccentRampPositions(`.a { color: var(${safe}); }`, 'x'), [], safe);
  }
});

test('a name in extraNames is flagged only when it is passed', () => {
  const source = '.a { color: var(--fx-fill); }';
  assert.deepEqual(scanAccentRampPositions(source, 'x'), []);
  const findings = scanAccentRampPositions(source, 'x', { extraNames: ['--fx-fill'] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.line, 1);
  assert.deepEqual(scanAccentRampPositions('.a { color: var(--fx-fill-2); }', 'x', { extraNames: ['--fx-fill'] }), []);
});

test('an extraNames entry that is not a custom-property name throws', () => {
  for (const bad of ['fx-fill', '--fx fill', '--fx)|(.', '', '--']) {
    assert.throws(() => scanAccentRampPositions('', 'x', { extraNames: [bad] }), TypeError, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------------------
// Target collection
// ---------------------------------------------------------------------------

test('the default walk collects the default extensions only', () => {
  assert.deepEqual([...DEFAULT_EXTENSIONS], ['.ts', '.tsx', '.css', '.html']);
  const files = collectScanTargets(HERE, ['fixtures']).map((file) => file.slice(FIXTURES.length + 1));
  assert.ok(files.length > 5);
  for (const file of files) assert.ok(DEFAULT_EXTENSIONS.some((extension) => file.endsWith(extension)), file);
  assert.ok(!files.some((file) => file.endsWith('.jsx') || file.endsWith('.js')));
});

test('an extensions list collects exactly those files, and a file root is taken as is', () => {
  const files = collectScanTargets(HERE, ['fixtures'], ['.jsx', '.js'])
    .map((file) => file.slice(FIXTURES.length + 1))
    .sort();
  assert.deepEqual(files, ['fx-component.jsx', 'fx-module.js']);
  const single = collectScanTargets(HERE, ['fixtures/fx-module.js']);
  assert.deepEqual(single, [join(FIXTURES, 'fx-module.js')]);
  assert.deepEqual(collectScanTargets(HERE, ['no-such-root']), []);
});
