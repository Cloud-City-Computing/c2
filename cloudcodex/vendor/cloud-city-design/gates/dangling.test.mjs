// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cloud City Computing, LLC

// node --test suite for dangling.mjs. Zero dependencies: run it from the
// package root with `node --test`, no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectDeclaredNames,
  declaredNames,
  inspectDangling,
  runDangling,
  scanDanglingVars,
} from './dangling.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const GOLDEN = 'fx-expected.json';

/** @param {string} name */
function readFixture(name) {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function fixtureNames() {
  return readdirSync(FIXTURES)
    .filter((name) => name !== GOLDEN)
    .sort();
}

/** @param {readonly { rule: string, file: string, line: number }[]} list */
function normalize(list) {
  return list
    .map(({ rule, file, line }) => ({ rule, file, line }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** The corpus's declared set: every name declared in a fixture stylesheet. */
function corpusDeclared() {
  /** @type {Set<string>} */
  const declared = new Set();
  for (const name of fixtureNames().filter((file) => file.endsWith('.css'))) {
    for (const declaredName of declaredNames(readFixture(name))) declared.add(declaredName);
  }
  return declared;
}

test('a BEM modifier followed by a pseudo-class is not a declaration', () => {
  assert.deepEqual(declaredNames(readFixture('fx-dangling.css')), ['--fx-a', '--fx-b']);
  assert.deepEqual(declaredNames('.a--b:hover { --c: 1; }'), ['--c']);
  assert.deepEqual(declaredNames('.a { /* --d: 1; */ --e: 1; }'), ['--e']);
});

test('a reference with a fallback, a declared reference and a commented one are not reported', () => {
  const declared = new Set(['--fx-a']);
  assert.deepEqual(scanDanglingVars('.a { x: var(--fx-z, 1px); y: var( --fx-a ); /* var(--fx-q) */ }', 'x', declared), []);
});

test('an undeclared reference is reported at its line, with its name, and a quoted one is scanned too', () => {
  const findings = scanDanglingVars(readFixture('fx-dangling.css'), 'sheet.css', corpusDeclared());
  assert.deepEqual(findings, [
    { rule: 'dangling-var', file: 'sheet.css', line: 3, name: '--fx-hot' },
    { rule: 'dangling-var', file: 'sheet.css', line: 4, name: '--fx-nope' },
    { rule: 'dangling-var', file: 'sheet.css', line: 8, name: '--fx-quoted' },
  ]);
});

test('the scanner over the fixture corpus returns exactly the golden dangling entries', () => {
  const declared = corpusDeclared();
  const actual = fixtureNames().flatMap((name) => scanDanglingVars(readFixture(name), name, declared));
  /** @type {{ rule: string, file: string, line: number }[]} */
  const golden = JSON.parse(readFixture(GOLDEN));
  const expected = golden.filter((entry) => entry.rule === 'dangling-var');
  assert.ok(expected.length > 0);
  assert.deepEqual(normalize(actual), normalize(expected));
});

test('the declared set is read from stylesheets only, files and directories alike', () => {
  const fromDirectory = collectDeclaredNames(HERE, ['fixtures']);
  assert.deepEqual([...fromDirectory].sort(), [...corpusDeclared()].sort());
  const fromFile = collectDeclaredNames(FIXTURES, ['fx-dangling.css', 'fx-module.js']);
  assert.deepEqual([...fromFile].sort(), ['--fx-a', '--fx-b']);
});

test('the gate over the fixture directory reports what it read, and none of it is empty', () => {
  const inspection = inspectDangling({ base: FIXTURES, declarationRoots: ['.'], referrerRoots: ['.'] });
  assert.ok(inspection.referrerFiles.length > 5, 'referrer files');
  assert.ok(inspection.referenceSites > 10, 'reference sites');
  assert.ok(inspection.referencedNames.size > 10, 'referenced names');
  assert.ok(inspection.declared.size > 10, 'declared names');
  assert.ok(inspection.findings.length > 0, 'findings');
  assert.ok(!inspection.referrerFiles.some((file) => file.endsWith('.jsx') || file.endsWith('.js')));
  for (const file of inspection.referrerFiles) assert.ok(!file.includes('\\') && !file.startsWith('/'), file);
  assert.deepEqual(runDangling({ base: FIXTURES, declarationRoots: ['.'], referrerRoots: ['.'] }), inspection.findings);
});

test('an extensions option reaches the referrer walk', () => {
  const jsx = runDangling({ base: FIXTURES, declarationRoots: ['.'], referrerRoots: ['.'], extensions: ['.jsx'] });
  assert.deepEqual(jsx, [{ rule: 'dangling-var', file: 'fx-component.jsx', line: 4, name: '--fx-nope' }]);
  const js = runDangling({ base: FIXTURES, declarationRoots: ['.'], referrerRoots: ['.'], extensions: ['.js'] });
  assert.deepEqual(js, [{ rule: 'dangling-var', file: 'fx-module.js', line: 5, name: '--fx-js-missing' }]);
  const byDefault = runDangling({ base: FIXTURES, declarationRoots: ['.'], referrerRoots: ['.'] });
  assert.ok(!byDefault.some((finding) => finding.file.endsWith('.jsx') || finding.file.endsWith('.js')));
});

test('the gate refuses to run without explicit roots', () => {
  assert.throws(() => inspectDangling(), TypeError);
  assert.throws(() => inspectDangling({ base: FIXTURES, referrerRoots: ['.'] }), TypeError);
  assert.throws(() => runDangling({ declarationRoots: ['.'], referrerRoots: ['.'] }), TypeError);
});
