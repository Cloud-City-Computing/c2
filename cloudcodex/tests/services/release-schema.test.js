import { describe, it, expect } from 'vitest';
import { c2_query } from '../../mysql_connect.js';
import { missingReleaseColumns, RELEASE_COLUMNS } from '../../services/release-schema.js';

const schemaWith = (...pairs) => pairs.map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }));
const everything = () => schemaWith(...RELEASE_COLUMNS.map(([t, c]) => [t, c]));

describe('missingReleaseColumns (W6-CDX-9, the boot check)', () => {
  it('answers nothing missing when every column this release reads is there', async () => {
    c2_query.mockResolvedValueOnce(everything());
    expect(await missingReleaseColumns()).toEqual([]);
  });

  it('names the migration for each column that is missing, so the boot can say what to run', async () => {
    c2_query.mockResolvedValueOnce(everything().filter((r) => !(r.TABLE_NAME === 'users' && r.COLUMN_NAME === 'deactivated_at')));
    expect(await missingReleaseColumns()).toEqual([
      ['users', 'deactivated_at', '2026-10-12-user-deactivation.sql'],
    ]);
  });

  it('answers null, not "all missing", when the schema reads empty: that is no evidence', async () => {
    c2_query.mockResolvedValueOnce([]);
    expect(await missingReleaseColumns()).toBeNull();
  });
});
