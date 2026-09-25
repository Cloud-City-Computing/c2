/**
 * Google's link-by-email interleaves under READ COMMITTED, against a live MySQL server
 *
 * At MySQL's default REPEATABLE READ an INSERT ... SELECT reads its source row
 * with a shared lock anyway, so the link INSERT would wait for a change to the
 * user row, and see it, even without its FOR SHARE. Under READ COMMITTED it
 * reads the row as a consistent read, without a lock, unless the SELECT says
 * FOR SHARE, and would link over an enable or an email change still being
 * committed. This file is what pins that clause. Every connection the app's
 * pool opens here runs SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
 * before its first query: mysql2's createPool is wrapped to add that one
 * listener, and nothing else about the driver or the server changes. The
 * first test proves the setting took. The interleaves are google-link-races.js,
 * the same ones oauth-google-two-factor.test.js runs at the default level.
 *
 * All Rights Reserved to Cloud City Computing, LLC 2026
 * https://cloudcitycomputing.com
 */

import { describe, it, expect, vi } from 'vitest';

const isolation = vi.hoisted(() => ({ errors: [] }));

vi.mock('mysql2/promise', async (importOriginal) => {
  const actual = await importOriginal();
  const driver = actual.default ?? actual;
  const createPool = (config) => {
    const pool = driver.createPool(config);
    // The core pool emits 'connection' after the handshake and before it
    // hands the connection to the query that asked for it, so this SET is
    // queued ahead of every query the app runs on that connection.
    pool.on('connection', (connection) => {
      connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED', (err) => {
        if (err) isolation.errors.push(err);
      });
    });
    return pool;
  };
  return { ...actual, default: { ...driver, createPool }, createPool };
});

import { c2_query } from '../../mysql_connect.js';
import { describeLinkRaces } from './google-link-races.js';

describe("the app's pool in this file", () => {
  it('runs every connection it opens under READ COMMITTED', async () => {
    // Five at once, each held briefly, so the pool has to open five connections.
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => c2_query('SELECT @@transaction_isolation AS level, SLEEP(0.2) AS slept', []))
    );

    expect(answers.map(([row]) => row.level)).toEqual(Array(5).fill('READ-COMMITTED'));
    expect(isolation.errors).toEqual([]);
  });
});

describeLinkRaces('READ COMMITTED on every app connection');
