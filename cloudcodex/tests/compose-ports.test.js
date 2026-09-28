/**
 * Pins every published port in the compose files to 127.0.0.1 unless a bind variable says otherwise
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// GHSA-9fmx-frrf-xxmq. Docker's published ports are a DNAT rule that sits in
// front of the host firewall, so a mapping with no host address is reachable
// from anywhere that can route to the machine, past `ufw deny`. The app port
// is published on loopback by default, for a reverse proxy on the same host;
// APP_BIND is the deliberate override. `:-` rather than `-` because
// .env.example ships APP_BIND blank, and a blank host address publishes on
// every interface.
const APP_PORT = '${APP_BIND:-127.0.0.1}:${PORT:-3000}:${PORT:-3000}';

// The same, for MySQL in the files that publish it at all: the host-side
// `npm run migrate` and a mysql client on the host (docs/deployment.md) reach
// it on 127.0.0.1, and in development so does the app, run on the host. The
// release file publishes nothing for the database; its app reaches MySQL over
// the compose network.
const DB_PORT = '${DB_BIND:-127.0.0.1}:3306:3306';

const EXPECTED = {
  'docker-compose-release.yml': { database: [], app: [APP_PORT] },
  'docker-compose-prod.yml': { database: [DB_PORT], app: [APP_PORT] },
  // Development: MySQL only, with a dev password, often on a laptop on a
  // shared network.
  'docker-compose.yaml': { database: [DB_PORT] },
  // start.sh merges this over the dev file on native Linux. Compose appends an
  // override's ports to the base file's, so it must publish nothing itself.
  'docker-compose.linux.yml': { database: [] },
};

/**
 * Each service's `ports:` list, read by indentation: services at two spaces
 * under `services:`, their keys at four, list items deeper. Enough YAML for
 * these files; a list written any other way reads as empty, which fails the
 * pin below rather than passing it.
 */
function publishedPorts(text) {
  const services = {};
  let inServices = false;
  let service = null;
  let inPorts = false;
  for (const raw of text.split('\n')) {
    if (/^\s*(#.*)?$/.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    if (indent === 0) {
      inServices = line === 'services:';
      service = null;
      inPorts = false;
    } else if (indent === 2 && inServices) {
      service = line.replace(/:$/, '');
      services[service] = [];
      inPorts = false;
    } else if (indent === 4 && service) {
      inPorts = line === 'ports:';
    } else if (indent > 4 && inPorts && line.startsWith('- ')) {
      services[service].push(line.slice(2).trim().replace(/^(['"])(.*)\1$/, '$2'));
    }
  }
  return services;
}

/** A short-form mapping split on the colons outside `${...}`. */
function mappingParts(mapping) {
  const parts = [''];
  let depth = 0;
  for (const ch of mapping) {
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (ch === ':' && depth === 0) parts.push('');
    else parts[parts.length - 1] += ch;
  }
  return parts;
}

/**
 * Whether a mapping, with nothing set in .env, publishes beyond loopback. A
 * two-part mapping has no host address, so it is every interface; a host that
 * is a variable counts by its `:-` fallback, since a blank or unset variable
 * takes it (a `-` fallback does not cover blank, and no fallback is blank).
 */
function beyondLoopback(mapping) {
  const parts = mappingParts(mapping);
  const host = parts.length === 3 ? parts[0] : '';
  const fallback = host.match(/^\$\{[A-Z][A-Z0-9_]*:-([^}]*)\}$/)?.[1] ?? host;
  return !/^(127\.\d+\.\d+\.\d+|\[::1\])$/.test(fallback);
}

describe('the ports reader (non-vacuity)', () => {
  it('reads each service\'s list, quoted or not, and sees an all-interfaces mapping', () => {
    const ports = publishedPorts([
      'services:',
      '  database:',
      '    # a comment',
      '    ports:',
      '      - 3306:3306',
      '  app:',
      '    ports:',
      '      - "${PORT:-3000}:${PORT:-3000}"',
      '    env_file:',
      '      - .env',
      'volumes:',
      '  db_data:',
    ].join('\n'));
    expect(ports).toEqual({ database: ['3306:3306'], app: ['${PORT:-3000}:${PORT:-3000}'] });
    expect(ports.app).not.toEqual([APP_PORT]);
  });

  it.each([
    ['${PORT:-3000}:${PORT:-3000}', true],
    ['3000:3000', true],
    ['0.0.0.0:3000:3000', true],
    ['${APP_BIND}:${PORT:-3000}:${PORT:-3000}', true],
    ['${APP_BIND-127.0.0.1}:${PORT:-3000}:${PORT:-3000}', true],
    ['${APP_BIND:-0.0.0.0}:${PORT:-3000}:${PORT:-3000}', true],
    ['target: 3000', true],
    ['3306:3306', true],
    ['${DB_BIND-127.0.0.1}:3306:3306', true],
    ['${DB_BIND}:3306:3306', true],
    [APP_PORT, false],
    [DB_PORT, false],
    ['127.0.0.1:3000:3000', false],
  ])('judges %j beyond loopback: %j', (mapping, expected) => {
    expect(beyondLoopback(mapping)).toBe(expected);
  });
});

describe('compose published ports', () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    const ports = publishedPorts(readFileSync(path.join(REPO, file), 'utf8'));

    it(`${file} has its services to check (non-vacuity)`, () => {
      expect(Object.keys(ports).sort()).toEqual(Object.keys(expected).sort());
    });

    for (const [service, mappings] of Object.entries(expected)) {
      it(`${file} publishes ${service} ${mappings.length ? `as ${mappings.join(', ')} only` : 'nowhere'}`, () => {
        expect(ports[service]).toEqual(mappings);
      });
    }

    // Not the pins restated: this reads what every mapping does, so editing a
    // pin and its file together to an all-interfaces default still fails, and
    // so does a new service that publishes a port with no host address.
    it(`${file} publishes nothing beyond loopback by default`, () => {
      const beyond = Object.entries(ports).flatMap(([service, list]) =>
        list.filter(beyondLoopback).map((m) => `${service} ${m}`));
      expect(beyond).toEqual([]);
    });
  }
});
