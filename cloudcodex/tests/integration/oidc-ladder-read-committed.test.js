/**
 * The OIDC ladder's interleaves under READ COMMITTED, against a live MySQL server
 *
 * The same mechanism as oauth-google-two-factor-read-committed.test.js: every connection the app's pool
 * opens runs under READ COMMITTED, where the link INSERT reads its row as a consistent read unless its
 * SELECT says FOR SHARE. The first test proves the setting took.
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
import { describeOidcLadderRaces } from './oidc-ladder-races.js';

describe("the app's pool in this file", () => {
  it('runs every connection it opens under READ COMMITTED', async () => {
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => c2_query('SELECT @@transaction_isolation AS level, SLEEP(0.2) AS slept', []))
    );

    expect(answers.map(([row]) => row.level)).toEqual(Array(5).fill('READ-COMMITTED'));
    expect(isolation.errors).toEqual([]);
  });
});

describeOidcLadderRaces('READ COMMITTED on every app connection');
