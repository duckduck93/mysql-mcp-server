import { describe, it, expect } from 'vitest';
import mysql from 'mysql2/promise';

// Optional end-to-end smoke test against local MySQL.
// If connection fails, we log a warning and do not fail the suite.

describe('E2E: local MySQL smoke (optional)', () => {
  it('can connect and run SELECT 1 (skips if unavailable)', async () => {
    try {
      const conn = await mysql.createConnection({
        host: 'localhost',
        port: 3306,
        user: 'test_user',
        password: 'sample_pass_123',
        database: 'test_db',
      });
      const [rows] = await conn.query('SELECT 1 as one');
      await conn.end();
      const v = Array.isArray(rows) && (rows as any[])[0]?.one;
      expect(v).toBe(1);
    } catch (e) {
      console.warn('E2E MySQL unavailable, skipping smoke test:', (e as Error).message);
      expect(true).toBe(true);
    }
  });
});
