/**
 * Pins every documented first install on a production compose file to the steps a fresh install needs
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// A reader who copies one of these blocks and nothing else must end up with a
// ready instance. Two things are easy to leave out: the one-time
// `--adopt-fresh-install` (without it /readyz stays 503 "migrations" and
// Docker reports the container unhealthy), and APP_URL, which production
// refuses to start without. docs/plans, docs/specs and docs/research are
// dated records, not instructions, so they are not read.
const RECORD_DIRS = /^docs\/(plans|specs|research)\//;

function markdownFiles(dir, rel = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...markdownFiles(path.join(dir, entry.name), relPath));
    else if (entry.name.endsWith('.md')) out.push(relPath);
  }
  return out;
}

/** Every fenced block that copies .env.example and starts a production compose file, with its line. */
function firstInstallBlocks(markdown, file) {
  const blocks = [];
  for (const m of markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    const body = m[1];
    if (!body.includes('cp .env.example .env')) continue;
    const up = body.match(/docker compose -f (docker-compose-(?:release|prod)\.yml) up\b[^\n]*/);
    if (!up) continue;
    blocks.push({ where: `${file}:${markdown.slice(0, m.index).split('\n').length}`, body, file: up[1], up: up[0] });
  }
  return blocks;
}

/** What a first-install block leaves out, as sentences; empty when it is complete. */
function firstInstallProblems(block) {
  const problems = [];
  const cpLine = block.body.split('\n').find((l) => l.includes('cp .env.example .env'));
  if (!/APP_URL/.test(cpLine)) problems.push(`${block.where} does not name APP_URL where it copies .env.example`);
  if (!/\s-d\b/.test(block.up)) problems.push(`${block.where} runs ${block.file} in the foreground, so the next step never runs`);
  const adopt = new RegExp(`docker compose -f ${block.file.replace(/\./g, '\\.')} run --rm app\\s*\\\\?\\s*npm run migrate -- --adopt-fresh-install`);
  if (!adopt.test(block.body)) problems.push(`${block.where} leaves out the one-time --adopt-fresh-install`);
  return problems;
}

describe('the first-install check (non-vacuity)', () => {
  it('flags the README block that sent readers to a 503', () => {
    const [block] = firstInstallBlocks([
      '```bash',
      'cp .env.example .env   # fill in DB and admin credentials; SMTP is optional',
      'docker compose -f docker-compose-release.yml up',
      '```',
    ].join('\n'), 'README.md');
    expect(firstInstallProblems(block)).toEqual([
      'README.md:1 does not name APP_URL where it copies .env.example',
      'README.md:1 runs docker-compose-release.yml in the foreground, so the next step never runs',
      'README.md:1 leaves out the one-time --adopt-fresh-install',
    ]);
  });

  it('accepts a complete block, the adopt step split over two lines included', () => {
    const [block] = firstInstallBlocks([
      '```bash',
      'cp .env.example .env   # fill in DB and admin credentials and APP_URL',
      'docker compose -f docker-compose-prod.yml up -d --build',
      'docker compose -f docker-compose-prod.yml run --rm app \\',
      '   npm run migrate -- --adopt-fresh-install',
      '```',
    ].join('\n'), 'x.md');
    expect(firstInstallProblems(block)).toEqual([]);
  });

  it('does not accept the adopt step run against the other compose file', () => {
    const [block] = firstInstallBlocks([
      '```bash',
      'cp .env.example .env   # APP_URL',
      'docker compose -f docker-compose-prod.yml up -d',
      'docker compose -f docker-compose-release.yml run --rm app npm run migrate -- --adopt-fresh-install',
      '```',
    ].join('\n'), 'x.md');
    expect(firstInstallProblems(block)).toEqual(['x.md:1 leaves out the one-time --adopt-fresh-install']);
  });
});

describe('documented first installs', () => {
  const files = ['README.md', ...markdownFiles(path.join(REPO, 'docs'), 'docs').filter((f) => !RECORD_DIRS.test(f))];
  const blocks = files.flatMap((f) => firstInstallBlocks(readFileSync(path.join(REPO, f), 'utf8'), f));

  it('finds the README and deployment.md blocks for both production files (non-vacuity)', () => {
    const seen = blocks.map((b) => `${b.where.split(':')[0]} ${b.file}`);
    expect(seen).toEqual(expect.arrayContaining([
      'README.md docker-compose-release.yml',
      'docs/deployment.md docker-compose-release.yml',
      'docs/deployment.md docker-compose-prod.yml',
    ]));
  });

  it('each one starts detached, adopts the fresh schema once, and names APP_URL', () => {
    expect(blocks.flatMap(firstInstallProblems)).toEqual([]);
  });
});
