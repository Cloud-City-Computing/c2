/**
 * Cloud Codex - Tests for the repository-root scripts/backup-common.sh that the backup and restore scripts share
 *
 * The restore refuses while anything holds the instance lock and holds it
 * itself while it loads, so its copy of the lock's name has to be the app's.
 * The Bash file cannot import the JavaScript, so this pins the two equal; the
 * behaviour is proved against a live MySQL by
 * tests/integration/backup-restore.test.js.
 *
 * Two checks need no MySQL and are pinned here: how the restore compares the
 * backup's release with this install's, and the refusal to reach a Compose
 * stack through a different compose file from the one it was created with
 * (driven through a stand-in `docker` on PATH that records every call).
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTANCE_LOCK_NAME_SQL } from '../../services/instance-lock.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts');
const COMMON = path.join(SCRIPTS, 'backup-common.sh');
const REPO_ROOT = path.resolve(SCRIPTS, '..');

/** The value of a `readonly NAME="..."` line in the Bash file. */
function bashConstant(name) {
  const match = new RegExp(`^readonly ${name}="([^"]*)"$`, 'm').exec(readFileSync(COMMON, 'utf8'));
  return match?.[1];
}

/** Run `bash args...` and resolve `{ code, stdout, stderr }` whatever the exit. */
function bash(args, env = {}) {
  return new Promise((resolve) => {
    execFile('bash', args, { env: { PATH: process.env.PATH, HOME: os.tmpdir(), ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
}

describe('scripts/backup-common.sh', () => {
  it('names the instance lock exactly as services/instance-lock.js does', () => {
    expect(bashConstant('INSTANCE_LOCK_NAME_SQL')).toBe(INSTANCE_LOCK_NAME_SQL);
  });

  describe('version_is_newer, which keeps a backup off an older release', () => {
    /** Whether the Bash function calls `a` newer than `b`. */
    async function newer(a, b) {
      const result = await bash(['-c', '. "$1"; if version_is_newer "$2" "$3"; then echo yes; else echo no; fi', 'bash', COMMON, a, b]);
      expect(result.stderr).toBe('');
      return result.stdout.trim() === 'yes';
    }

    it.each([
      ['0.13.0', '0.12.0', true],
      ['0.10.0', '0.9.0', true],     // numeric, not lexical
      ['1.0.0', '0.99.99', true],
      ['0.12.1', '0.12.0', true],
      ['0.12.0', '0.12.0', false],
      ['0.12.0', '0.13.0', false],
      ['0.9.0', '0.10.0', false],
      ['0.12.0', '0.12.0-rc.1', true],  // a release is newer than its own pre-release
      ['0.12.0-rc.1', '0.12.0', false],
      ['0.12.0-rc.2', '0.12.0-rc.1', true],
      ['0.12.0+build.5', '0.12.0', false], // build metadata does not order
    ])('%s newer than %s: %s', async (a, b, expected) => {
      expect(await newer(a, b)).toBe(expected);
    });
  });

  describe('the Compose transport and the file the stack was created from', () => {
    let dir;
    let log;

    beforeAll(() => {
      dir = mkdtempSync(path.join(os.tmpdir(), 'c2-compose-file-'));
      log = path.join(dir, 'docker.log');
      const bin = path.join(dir, 'bin');
      // A stand-in docker: the database container's id, the compose files
      // Compose labelled it with, and a failure for anything past that, so a
      // script that is let through stops at its next call, which the log shows.
      mkdirSync(bin);
      const stub = path.join(bin, 'docker');
      writeFileSync(stub, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$*" in
  "compose ps -a -q database") [ -z "$FAKE_CONFIG_FILES" ] || echo 0123456789ab ;;
  "inspect "*) printf '%s\\n' "$FAKE_CONFIG_FILES" ;;
  *) echo "stand-in docker stops here: $*" >&2; exit 99 ;;
esac
`);
      chmodSync(stub, 0o755);
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    async function runScript(script, args, env) {
      rmSync(log, { force: true });
      const result = await bash([path.join(SCRIPTS, script), ...args], {
        PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: log,
        ...env,
      });
      return { ...result, calls: existsSync(log) ? readFileSync(log, 'utf8') : '' };
    }

    it.each(['backup.sh', 'restore.sh'])('%s refuses a stack created from another compose file, naming it', async (script) => {
      const target = script === 'backup.sh' ? path.join(dir, 'out.tar.gz') : path.join(dir, 'in.tar.gz');
      if (script === 'restore.sh') writeFileSync(target, '');
      const result = await runScript(script, [target], { FAKE_CONFIG_FILES: '/srv/c2/docker-compose-prod.yml' });

      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/docker-compose-prod\.yml/);
      expect(result.stderr).toMatch(/COMPOSE_FILE/);
      expect(result.calls).not.toMatch(/compose (exec|run|up)/);
      expect(existsSync(path.join(dir, 'out.tar.gz'))).toBe(false);
    });

    it('goes on when the stack was created from the same file, wherever the checkout was', async () => {
      const result = await runScript('backup.sh', [path.join(dir, 'out.tar.gz')], {
        FAKE_CONFIG_FILES: '/somewhere/else/docker-compose-release.yml',
      });
      expect(result.stderr).not.toMatch(/created from/);
      expect(result.calls).toMatch(/^compose exec -T database/m);
    });

    it('goes on when COMPOSE_FILE names the file the stack was created from', async () => {
      const result = await runScript('backup.sh', [path.join(dir, 'out.tar.gz')], {
        COMPOSE_FILE: path.join(REPO_ROOT, 'docker-compose-prod.yml'),
        FAKE_CONFIG_FILES: path.join(REPO_ROOT, 'docker-compose-prod.yml'),
      });
      expect(result.stderr).not.toMatch(/created from/);
      expect(result.calls).toMatch(/^compose exec -T database/m);
    });

    it('goes on when no stack exists yet', async () => {
      const result = await runScript('backup.sh', [path.join(dir, 'out.tar.gz')], { FAKE_CONFIG_FILES: '' });
      expect(result.stderr).not.toMatch(/created from/);
      expect(result.calls).toMatch(/^compose exec -T database/m);
    });
  });
});
