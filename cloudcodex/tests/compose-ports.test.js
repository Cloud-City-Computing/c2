/**
 * Pins every published port in the compose files to 127.0.0.1 unless a bind variable says otherwise
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { contractDefault } from './contract-default.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every compose file at the repository root, found by name, so a new one
// cannot slip past: it fails below until it has an entry in EXPECTED.
const COMPOSE_FILES = readdirSync(REPO).filter((f) => /^docker-compose.*\.ya?ml$/.test(f)).sort();

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
// it on 127.0.0.1, and in development so does the app, run on the host.
const DB_PORT = '${DB_BIND:-127.0.0.1}:3306:3306';

// The compose network the app containers sit on, pinned so its gateway (where
// a proxy on the host arrives from) is an address TRUST_PROXY's default names.
const PINNED_NETWORK = { subnet: '172.29.0.0/16', gateway: '172.29.0.1' };

const EXPECTED = {
  // The release file publishes no database port; its app reaches MySQL over
  // the compose network, and `expose` says so.
  'docker-compose-release.yml': {
    ports: { database: [], app: [APP_PORT] }, expose: { database: ['3306'] }, network: PINNED_NETWORK,
  },
  'docker-compose-prod.yml': { ports: { database: [DB_PORT], app: [APP_PORT] }, network: PINNED_NETWORK },
  // Development: MySQL only, with a dev password, often on a laptop on a
  // shared network.
  'docker-compose.yaml': { ports: { database: [DB_PORT] } },
  // start.sh merges this over the dev file on native Linux. Compose appends an
  // override's ports to the base file's, so it must publish nothing itself.
  'docker-compose.linux.yml': { ports: { database: [] } },
};

/**
 * A value as Compose interpolates it with nothing set, or set blank, in
 * .env: `${NAME:-default}` takes the default; `${NAME-default}` keeps the
 * blank, since `-` covers unset only; `${NAME}` and `${NAME:?...}` are blank.
 */
function interpolatedUnset(value) {
  return String(value).replace(/\$\{[A-Za-z_][A-Za-z0-9_]*(?::-([^}]*)|[^}]*)\}/g, (_m, fallback) => fallback ?? '');
}

/**
 * The host address a `ports` entry publishes on, with nothing set in .env,
 * for the short syntax (`[HOST:]PUBLISHED:TARGET`, a bare number or target)
 * and the long one (`host_ip`). Blank means every interface.
 */
function hostOf(entry) {
  if (entry !== null && typeof entry === 'object') return interpolatedUnset(entry.host_ip ?? '');
  const text = interpolatedUnset(entry).replace(/\/(tcp|udp|sctp)$/, '');
  if (text.startsWith('[')) return text.slice(1, text.indexOf(']'));
  const parts = text.split(':');
  return parts.length === 3 ? parts[0] : '';
}

const isLoopback = (host) => /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host === '::1';

/** Each service's `ports` and `expose`, merge keys and all, as YAML reads them. */
function servicesOf(text) {
  const doc = yaml.load(text) ?? {};
  return Object.fromEntries(Object.entries(doc.services ?? {}).map(([name, def]) => [name, {
    ports: def?.ports ?? [],
    expose: (def?.expose ?? []).map(String),
    networks: def?.networks,
    networkMode: def?.network_mode,
  }]));
}

/** Every mapping, in any file, that publishes beyond loopback by default. */
const beyondLoopback = (services) => Object.entries(services).flatMap(([name, def]) =>
  def.ports.filter((entry) => !isLoopback(hostOf(entry))).map((entry) => `${name} ${JSON.stringify(entry)}`));

describe('the ports reader (non-vacuity)', () => {
  // The review's spellings: each publishes 3306 on every interface, and each
  // must be seen, or an override could widen the dev mapping unnoticed.
  it.each([
    ['a block list', 'services:\n  database:\n    ports:\n      - 3306:3306\n'],
    ['a flow list', 'services:\n  database:\n    ports: ["3306:3306"]\n'],
    ['a commented key', 'services:\n  database:\n    ports: # published for the host\n      - "3306:3306"\n'],
    ['a quoted key', 'services:\n  database:\n    "ports":\n      - "3306:3306"\n'],
    ['a merged anchor', 'x-db: &db\n  ports: ["3306:3306"]\nservices:\n  database:\n    <<: *db\n    volumes: [./x:/y]\n'],
    ['the long syntax', 'services:\n  database:\n    ports:\n      - target: 3306\n        published: 3306\n'],
    ['a bare number', 'services:\n  database:\n    ports: [3306]\n'],
  ])('sees %s', (_label, text) => {
    expect(beyondLoopback(servicesOf(text))).toHaveLength(1);
  });

  it.each([
    [APP_PORT, '127.0.0.1'],
    [DB_PORT, '127.0.0.1'],
    ['${PORT:-3000}:${PORT:-3000}', ''],
    ['0.0.0.0:3000:3000', '0.0.0.0'],
    ['${APP_BIND}:${PORT:-3000}:${PORT:-3000}', ''],
    ['${APP_BIND-127.0.0.1}:${PORT:-3000}:${PORT:-3000}', ''],
    ['${APP_BIND:-0.0.0.0}:3000:3000', '0.0.0.0'],
    ['[::1]:3000:3000', '::1'],
    ['127.0.0.1:3306:3306/tcp', '127.0.0.1'],
    [{ target: 3000, published: 3000, host_ip: '${APP_BIND:-127.0.0.1}' }, '127.0.0.1'],
    [{ target: 3000, published: 3000 }, ''],
  ])('reads the host of %j as %j', (entry, host) => {
    expect(hostOf(entry)).toBe(host);
  });
});

describe('compose published ports', () => {
  it('finds every compose file at the repository root (non-vacuity)', () => {
    expect(COMPOSE_FILES).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [file, expected] of Object.entries(EXPECTED)) {
    const text = readFileSync(path.join(REPO, file), 'utf8');
    const services = servicesOf(text);

    it(`${file} has its services to check (non-vacuity)`, () => {
      expect(Object.keys(services).sort()).toEqual(Object.keys(expected.ports).sort());
    });

    for (const [service, mappings] of Object.entries(expected.ports)) {
      it(`${file} publishes ${service} ${mappings.length ? `as ${mappings.join(', ')} only` : 'nowhere'}`, () => {
        expect(services[service].ports.map((e) => (typeof e === 'object' ? e : String(e)))).toEqual(mappings);
      });
    }

    for (const [service, exposed] of Object.entries(expected.expose ?? {})) {
      it(`${file} exposes ${service} to the compose network only, as ${exposed.join(', ')}`, () => {
        expect(services[service].expose).toEqual(exposed);
      });
    }

    // Not the pins restated: this reads what every mapping does, so editing a
    // pin and its file together to an all-interfaces default still fails.
    it(`${file} publishes nothing beyond loopback by default`, () => {
      expect(beyondLoopback(services)).toEqual([]);
    });

    if (expected.network) {
      it(`${file} pins the default network to ${expected.network.subnet}, and TRUST_PROXY's default names its gateway`, () => {
        const doc = yaml.load(text);
        expect(doc.networks?.default?.ipam?.config).toEqual([expected.network]);
        expect(contractDefault('TRUST_PROXY').split(',').map((e) => e.trim()))
          .toContain(`${expected.network.gateway}/32`);
        // The app must be on that network, not moved off it by a service key.
        expect(services.app.networks).toBeUndefined();
        expect(services.app.networkMode).toBeUndefined();
      });
    }
  }
});

describe('.env.example', () => {
  const example = readFileSync(path.join(REPO, '.env.example'), 'utf8');

  // Blank is what makes the `:-` fallbacks above apply to a fresh .env.
  it.each(['APP_BIND', 'DB_BIND'])('ships %s blank', (name) => {
    expect(example).toMatch(new RegExp(`^${name}=$`, 'm'));
  });
});
