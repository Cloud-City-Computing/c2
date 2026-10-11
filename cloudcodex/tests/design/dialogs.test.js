/**
 * Cloud Codex - Dialogs are dialogs, in every file under src/
 *
 * A bare div overlay is not a dialog to a screen reader and takes no focus. Every element that is
 * a dialog wrapper carries role="dialog" and aria-modal="true" in its own markup, and every close
 * control is a real button named Close. The scan reads the source of every file under src/, the way
 * painted.test.js scans for suppressed focus rings, and each form is seeded first so the scan
 * cannot pass by finding nothing.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './buckets.js';

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return walk(full);
  return /\.(css|js|jsx)$/.test(e.name) ? [full] : [];
});

// Every opening tag of an element, with its attributes. A JSX attribute may hold `>` inside braces
// (an arrow function), so braces are matched as a unit.
const OPENING_TAG = /<([a-zA-Z][\w.]*)((?:[^>{}"']|"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g;

const classesOf = (attrs) => {
  const m = /className=(?:"([^"]*)"|\{\s*(['"`])([^'"`]*)\2\s*\})/.exec(attrs);
  return m ? (m[1] ?? m[3]).split(/\s+/) : [];
};

// The dialog wrappers: an element with one of these class tokens is the dialog itself.
const DIALOG_CLASSES = ['modal-content-wrapper', 'gh-modal', 'image-crop-modal'];

/** Every violation in one source: a dialog wrapper with no dialog role, a close control that is not a named button. */
function violationsIn(source) {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
  const found = [];
  for (const [tag, tagName, attrs] of bare.matchAll(OPENING_TAG)) {
    const classes = classesOf(attrs);
    if (DIALOG_CLASSES.some((c) => classes.includes(c))) {
      if (!/\brole=["']dialog["']/.test(attrs) || !/aria-modal=(?:"true"|\{true\})/.test(attrs)) {
        found.push(`${tag.trim()} is a dialog wrapper without role="dialog" and aria-modal`);
      }
    }
    if (classes.includes('close-button')) {
      const isNamedButton = tagName === 'button' && /aria-label="Close"/.test(attrs) && /type="button"/.test(attrs);
      if (!isNamedButton) found.push(`${tagName} close-button is not a button named Close`);
    }
  }
  return found;
}

const SRC = path.join(ROOT, 'src');

describe('the scan that makes every dialog a dialog', () => {
  it('flags a bare div overlay and a span close control in a seeded source, and passes the real form', () => {
    expect(violationsIn('<div className="modal-content-wrapper">x</div>')).toHaveLength(1);
    expect(violationsIn('<div className="gh-modal gh-modal--wide">x</div>')).toHaveLength(1);
    expect(violationsIn('<span className="close-button" onClick={close}>&times;</span>')).toHaveLength(1);
    expect(violationsIn('<button type="button" className="close-button" aria-label="Close" onClick={() => go()}>&times;</button>')).toEqual([]);
    expect(violationsIn('<div className="modal-content-wrapper" role="dialog" aria-modal="true" ref={r}>x</div>')).toEqual([]);
    // A backdrop is not a dialog, and a `gh-modal-backdrop` token is not the `gh-modal` dialog.
    expect(violationsIn('<div className="modal-dimmer first-run-dimmer">x</div>')).toEqual([]);
    expect(violationsIn('<div className="gh-modal-backdrop" onClick={() => {}}>x</div>')).toEqual([]);
  });

  it('finds no dialog wrapper without its role, and no close control that is not a named button, in any file under src/', () => {
    const found = walk(SRC).flatMap((file) => violationsIn(readFileSync(file, 'utf8'))
      .map((hit) => `${path.relative(ROOT, file)}: ${hit}`));
    expect(found, 'a dialog is a role dialog, and a close control is a button').toEqual([]);
  });

  // The scan is not vacuous: it sees the seven dialog wrappers in src/ today, five GitHub modals,
  // the image crop and the first-run welcome. A new wrapper that the scan misses changes this count.
  it('sees the seven dialog wrappers that src/ has today', () => {
    const wrappers = walk(SRC).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(OPENING_TAG)]
      .filter(([, , attrs]) => classesOf(attrs).some((c) => DIALOG_CLASSES.includes(c))));
    expect(wrappers).toHaveLength(7);
  });
});

describe('the modal scrim is a token, and the dimmer draws no blur', () => {
  const index = readFileSync(path.join(ROOT, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // The declarations of the rule whose selector list names `selector` (a rule may share a list).
  const rule = (selector) => {
    for (const m of index.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (m[1].split(',').map((x) => x.trim()).includes(selector)) return m[2];
    }
    throw new Error(`${selector} has no rule in src/index.css`);
  };

  it('paints #modal-dimmer with --cx-scrim, and with no backdrop-filter', () => {
    expect(rule('#modal-dimmer')).toMatch(/background:\s*var\(--cx-scrim\)/);
    expect(rule('#modal-dimmer')).not.toMatch(/backdrop-filter/);
  });

  it('paints the first-run dimmer the same way', () => {
    expect(rule('.first-run-dimmer')).toMatch(/background:\s*var\(--cx-scrim\)/);
    expect(rule('.first-run-dimmer')).not.toMatch(/backdrop-filter/);
  });

  it('resets the close control to a plain button that keeps its look', () => {
    const close = rule('.close-button');
    expect(close).toMatch(/background:\s*none/);
    expect(close).toMatch(/border:\s*0/);
    expect(close).toMatch(/padding:\s*0/);
    expect(close).toMatch(/font-family:\s*inherit/);
  });
});
