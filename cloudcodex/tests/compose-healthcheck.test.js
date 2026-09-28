/**
 * Pins the MySQL readiness checks to TCP, so a first boot waits for the real server
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The files an operator runs as they are, each with a database healthcheck
// the app waits on through `depends_on: condition: service_healthy`.
const PRODUCTION_COMPOSE = ['docker-compose-release.yml', 'docker-compose-prod.yml'];

// On an empty data directory the MySQL image first runs a temporary server
// with networking off (socket only) to apply init.sql, then stops it and
// starts the real one. A socket ping answers the temporary server, so the
// database reported healthy while nothing listened on 3306, and the app,
// which connects over the network, exited on ECONNREFUSED until the restart
// policy brought it back. A ping over TCP to 127.0.0.1 has nothing to answer
// it until the real server is listening.
function tcpPingProblems(argv) {
  const problems = [];
  if (!Array.isArray(argv) || argv[0] !== 'CMD') return ['is not an exec-form ["CMD", ...] array'];
  if (argv[1] !== 'mysqladmin' || argv[2] !== 'ping') problems.push('is not mysqladmin ping');
  const host = argv.indexOf('-h');
  if (host === -1 || argv[host + 1] !== '127.0.0.1') problems.push('does not name -h 127.0.0.1');
  if (!argv.includes('--protocol=tcp')) problems.push('does not force --protocol=tcp');
  return problems;
}

// The database service's healthcheck block: the lines indented under
// `healthcheck:`, as key -> raw value.
function databaseHealthcheck(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^ {4}healthcheck:\s*$/.test(l));
  if (start === -1) return null;
  const block = {};
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^ {6}([a-z_]+):\s*(.*)$/);
    if (!m) break;
    block[m[1]] = m[2];
  }
  return block;
}

describe('the TCP ping check (non-vacuity)', () => {
  it('flags the socket-only ping this file replaced', () => {
    expect(tcpPingProblems(['CMD', 'mysqladmin', 'ping', '-u${DB_USER}', '-p${DB_PASS}']))
      .toEqual(['does not name -h 127.0.0.1', 'does not force --protocol=tcp']);
  });

  it('flags a shell-form test and a different host', () => {
    expect(tcpPingProblems('mysqladmin ping')).toHaveLength(1);
    expect(tcpPingProblems(['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '--protocol=tcp']))
      .toEqual(['does not name -h 127.0.0.1']);
  });

  it('accepts the TCP ping', () => {
    expect(tcpPingProblems(['CMD', 'mysqladmin', 'ping', '-h', '127.0.0.1', '--protocol=tcp', '-uX', '-pY']))
      .toEqual([]);
  });
});

describe('production compose database healthchecks', () => {
  for (const file of PRODUCTION_COMPOSE) {
    const text = readFileSync(path.join(REPO, file), 'utf8');
    const check = databaseHealthcheck(text);

    it(`${file} has a database healthcheck the app waits on (non-vacuity)`, () => {
      expect(check).not.toBeNull();
      expect(Object.keys(check)).toEqual(expect.arrayContaining(['test', 'interval', 'retries']));
      expect(text).toMatch(/condition: service_healthy/);
    });

    it(`${file} pings MySQL over TCP, which the temporary init server cannot answer`, () => {
      expect(tcpPingProblems(JSON.parse(check.test))).toEqual([]);
    });

    // The TCP ping now fails for the whole of a first boot's initialisation
    // instead of passing at once. Without a start period those failures count
    // against the retries, and a slow disk would mark the database unhealthy
    // before init.sql finished, so Compose would never start the app at all.
    it(`${file} gives a first boot's initialisation a start period`, () => {
      expect(check.start_period).toMatch(/^\d+s$/);
      expect(parseInt(check.start_period, 10)).toBeGreaterThanOrEqual(300);
    });
  }
});

describe('start.sh', () => {
  // The dev bootstrap waits for MySQL the same way before starting the app on
  // the host, which connects over TCP, so a socket ping would pass on the
  // temporary server there too.
  it('waits on a TCP ping, not the socket', () => {
    const script = readFileSync(path.join(REPO, 'start.sh'), 'utf8');
    const pings = script.split('\n').filter((l) => /mysqladmin\s+ping/.test(l));
    expect(pings.length).toBeGreaterThan(0);
    for (const line of pings) {
      expect(line).toMatch(/-h\s*127\.0\.0\.1/);
      expect(line).toMatch(/--protocol=tcp/);
    }
  });
});
