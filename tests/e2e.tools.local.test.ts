import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createDatabase, Database } from '../src/db.js';
import { registerQueryTool } from '../src/tools/query.js';
import { registerExecuteTool } from '../src/tools/execute.js';
import { registerShowTablesTool } from '../src/tools/show_tables.js';
import { registerDescribeTableTool } from '../src/tools/describe_table.js';
import { registerShowIndexesTool } from '../src/tools/show_indexes.js';
import { registerExplainTool } from '../src/tools/explain.js';
import { registerVersionTool } from '../src/tools/version.js';

class FakeServer {
  public tools: Record<string, { handler: Function } & any> = {};
  registerTool(name: string, meta: any, handler: any) {
    this.tools[name] = { meta, handler } as any;
  }
}

async function tryInitDb(): Promise<{ db: Database; cleanup: () => Promise<void> } | null> {
  // Provide default local env for tests
  process.env.MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
  process.env.MYSQL_PORT = process.env.MYSQL_PORT || '3306';
  process.env.MYSQL_USER = process.env.MYSQL_USER || 'test_user';
  process.env.MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'sample_pass_123';
  process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'test_db';
  process.env.MYSQL_SSL = process.env.MYSQL_SSL || 'off';
  process.env.MYSQL_CONNECT_TIMEOUT_MS = process.env.MYSQL_CONNECT_TIMEOUT_MS || '5000';
  process.env.MYSQL_QUERY_TIMEOUT_MS = process.env.MYSQL_QUERY_TIMEOUT_MS || '60000';
  process.env.MAX_ROWS = process.env.MAX_ROWS || '10000';

  const cfg = loadConfig();
  const db = createDatabase(cfg);
  try {
    // simple connectivity check
    await db.version();
  } catch (e) {
    await db.close().catch(() => {});
    // MySQL not available
    return null;
  }

  // Ensure clean playground
  await db.execute('DROP VIEW IF EXISTS v_users');
  await db.execute('DROP TABLE IF EXISTS users');
  await db.execute('CREATE TABLE users (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(50) NOT NULL, age INT NULL)');
  await db.execute('INSERT INTO users (name, age) VALUES ("alice", 30), ("bob", 25), ("carl", 28), ("dana", NULL), ("erin", 35)');
  await db.execute('CREATE VIEW v_users AS SELECT id, name FROM users');
  await db.execute('CREATE INDEX idx_users_age ON users(age)');

  const cleanup = async () => {
    try { await db.execute('DROP VIEW IF EXISTS v_users'); } catch {}
    try { await db.execute('DROP TABLE IF EXISTS users'); } catch {}
    await db.close().catch(() => {});
  };
  return { db, cleanup };
}

describe('E2E tools (optional, local MySQL)', () => {
  it('exercises tool handlers end-to-end against real DB (skips if unavailable)', { timeout: 120_000 }, async () => {
    const ctx = await tryInitDb();
    if (!ctx) {
      console.warn('E2E tools test: MySQL unavailable, skipping.');
      expect(true).toBe(true);
      return;
    }
    const { db, cleanup } = ctx;
    const server = new FakeServer();

    const cfg = loadConfig();
    registerQueryTool(server as any, db, { maxRows: cfg.MAX_ROWS, timeoutMs: cfg.MYSQL_QUERY_TIMEOUT_MS });
    registerExecuteTool(server as any, db, { timeoutMs: cfg.MYSQL_QUERY_TIMEOUT_MS });
    registerShowTablesTool(server as any, db);
    registerDescribeTableTool(server as any, db);
    registerShowIndexesTool(server as any, db);
    registerExplainTool(server as any, db);
    registerVersionTool(server as any, db);

    try {
      // version
      const ver = await server.tools.version.handler({});
      expect(ver.structuredContent.version).toMatch(/\d+\.\d+\.\d+/);

      // show_tables without views
      const st1 = await server.tools.show_tables.handler({});
      const names1 = st1.structuredContent.tables.map((t: any) => t.name);
      expect(names1).toContain('users');
      const types1 = st1.structuredContent.tables.reduce((acc: Record<string, string>, t: any) => (acc[t.name] = t.type, acc), {} as any);
      expect(types1['users']).toBe('BASE TABLE');
      // show_tables with views
      const st2 = await server.tools.show_tables.handler({ includeViews: true });
      const names2 = st2.structuredContent.tables.map((t: any) => t.name);
      expect(names2).toContain('v_users');

      // describe_table
      const dt = await server.tools.describe_table.handler({ table: 'users' });
      expect(dt.structuredContent.table).toBe('users');
      const cols = dt.structuredContent.columns.map((c: any) => c.name);
      expect(cols).toEqual(['id', 'name', 'age']);

      // show_indexes
      const si = await server.tools.show_indexes.handler({ table: 'users' });
      const idxNames = si.structuredContent.indexes.map((i: any) => i.name);
      expect(idxNames).toContain('PRIMARY');
      expect(idxNames).toContain('idx_users_age');

      // query: basic and truncation
      const q1 = await server.tools.query.handler({ sql: 'SELECT name FROM users WHERE age >= ?', params: [28] });
      const r1 = q1.structuredContent.rows.map((r: any) => r.name).sort();
      expect(r1.length).toBeGreaterThan(0);
      const q2 = await server.tools.query.handler({ sql: 'SELECT id FROM users ORDER BY id', maxRows: 2 });
      expect(q2.structuredContent.rows.length).toBe(2);
      expect(q2.structuredContent.truncated).toBe(true);

      // explain
      const ex = await server.tools.explain.handler({ sql: 'SELECT * FROM users WHERE id = ?', params: [1] });
      expect(Array.isArray(ex.structuredContent.plan)).toBe(true);
      expect(ex.structuredContent.plan.length).toBeGreaterThan(0);

      // execute: insert row and verify
      const ins = await server.tools.execute.handler({ sql: 'INSERT INTO users (name, age) VALUES (?, ?)', params: ['zoe', 22] });
      expect(ins.structuredContent.affectedRows).toBe(1);
      const chk = await server.tools.query.handler({ sql: 'SELECT COUNT(*) as cnt FROM users WHERE name=?', params: ['zoe'] });
      expect(chk.structuredContent.rows[0].cnt ?? chk.structuredContent.rows[0].CNT).toBe(1);
    } finally {
      await cleanup();
    }
  });
});
