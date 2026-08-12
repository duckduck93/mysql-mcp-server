import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createDatabase, Database } from '../src/db.js';
import { ProfileRegistry } from '../src/profile-registry.js';
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

const E2E_PROFILE = 'e2e-local';

/** 파일 대신 메모리에서 읽는 레지스트리. 로컬 docker DB 를 가리킨다. */
function localRegistry() {
  const profiles = {
    [E2E_PROFILE]: {
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE || 'test_db',
      user: process.env.MYSQL_USER || 'test_user',
      enabled: true,
      readonly: false,
      maxRows: 10000,
      production: false,
      description: '로컬 docker 테스트 DB',
    },
  };
  return ProfileRegistry.withReader('e2e-memory.json', () => JSON.stringify(profiles));
}

async function tryInitDb(): Promise<{ db: Database; cleanup: () => Promise<void> } | null> {
  process.env.MYSQL_PROFILE = E2E_PROFILE;
  process.env.MYSQL_SSL = process.env.MYSQL_SSL || 'off';
  process.env.MYSQL_CONNECT_TIMEOUT_MS = process.env.MYSQL_CONNECT_TIMEOUT_MS || '5000';
  process.env.MYSQL_QUERY_TIMEOUT_MS = process.env.MYSQL_QUERY_TIMEOUT_MS || '60000';

  const cfg = loadConfig();
  // 로컬 테스트 DB 라 Keychain 을 태우지 않고 고정 비밀번호 대역을 넣는다.
  const db = createDatabase({
    registry: localRegistry(),
    profileName: E2E_PROFILE,
    cfg,
    secrets: { resolve: async () => process.env.MYSQL_E2E_PASSWORD || 'sample_pass_123' },
  });
  try {
    // simple connectivity check
    await db.version({ profile: E2E_PROFILE });
  } catch (e) {
    await db.close().catch(() => {});
    // MySQL not available
    return null;
  }

  // Ensure clean playground
  await db.execute({ profile: E2E_PROFILE, sql: 'DROP VIEW IF EXISTS v_users' });
  await db.execute({ profile: E2E_PROFILE, sql: 'DROP TABLE IF EXISTS users' });
  await db.execute({ profile: E2E_PROFILE, sql: 'CREATE TABLE users (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(50) NOT NULL, age INT NULL)' });
  await db.execute({ profile: E2E_PROFILE, sql: 'INSERT INTO users (name, age) VALUES ("alice", 30), ("bob", 25), ("carl", 28), ("dana", NULL), ("erin", 35)' });
  await db.execute({ profile: E2E_PROFILE, sql: 'CREATE VIEW v_users AS SELECT id, name FROM users' });
  await db.execute({ profile: E2E_PROFILE, sql: 'CREATE INDEX idx_users_age ON users(age)' });

  const cleanup = async () => {
    try { await db.execute({ profile: E2E_PROFILE, sql: 'DROP VIEW IF EXISTS v_users' }); } catch {}
    try { await db.execute({ profile: E2E_PROFILE, sql: 'DROP TABLE IF EXISTS users' }); } catch {}
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
    const choices = [{ name: E2E_PROFILE, description: '로컬 docker 테스트 DB' }];
    registerQueryTool(server as any, db, { choices, timeoutMs: cfg.MYSQL_QUERY_TIMEOUT_MS });
    registerExecuteTool(server as any, db, { choices, timeoutMs: cfg.MYSQL_QUERY_TIMEOUT_MS });
    registerShowTablesTool(server as any, db, { choices });
    registerDescribeTableTool(server as any, db, { choices });
    registerShowIndexesTool(server as any, db, { choices });
    registerExplainTool(server as any, db, { choices });
    registerVersionTool(server as any, db, { choices });

    try {
      // version
      const ver = await server.tools.version.handler({ profile: E2E_PROFILE });
      expect(ver.structuredContent.version).toMatch(/\d+\.\d+\.\d+/);

      // show_tables without views
      const st1 = await server.tools.show_tables.handler({ profile: E2E_PROFILE });
      const names1 = st1.structuredContent.tables.map((t: any) => t.name);
      expect(names1).toContain('users');
      const types1 = st1.structuredContent.tables.reduce((acc: Record<string, string>, t: any) => (acc[t.name] = t.type, acc), {} as any);
      expect(types1['users']).toBe('BASE TABLE');
      // show_tables with views
      const st2 = await server.tools.show_tables.handler({ profile: E2E_PROFILE, includeViews: true });
      const names2 = st2.structuredContent.tables.map((t: any) => t.name);
      expect(names2).toContain('v_users');

      // describe_table
      const dt = await server.tools.describe_table.handler({ profile: E2E_PROFILE, table: 'users' });
      expect(dt.structuredContent.table).toBe('users');
      const cols = dt.structuredContent.columns.map((c: any) => c.name);
      expect(cols).toEqual(['id', 'name', 'age']);

      // show_indexes
      const si = await server.tools.show_indexes.handler({ profile: E2E_PROFILE, table: 'users' });
      const idxNames = si.structuredContent.indexes.map((i: any) => i.name);
      expect(idxNames).toContain('PRIMARY');
      expect(idxNames).toContain('idx_users_age');

      // query: basic and truncation
      const q1 = await server.tools.query.handler({ profile: E2E_PROFILE, sql: 'SELECT name FROM users WHERE age >= ?', params: [28] });
      const r1 = q1.structuredContent.rows.map((r: any) => r.name).sort();
      expect(r1.length).toBeGreaterThan(0);
      const q2 = await server.tools.query.handler({ profile: E2E_PROFILE, sql: 'SELECT id FROM users ORDER BY id', maxRows: 2 });
      expect(q2.structuredContent.rows.length).toBe(2);
      expect(q2.structuredContent.truncated).toBe(true);

      // explain
      const ex = await server.tools.explain.handler({ profile: E2E_PROFILE, sql: 'SELECT * FROM users WHERE id = ?', params: [1] });
      expect(Array.isArray(ex.structuredContent.plan)).toBe(true);
      expect(ex.structuredContent.plan.length).toBeGreaterThan(0);

      // execute: insert row and verify
      const ins = await server.tools.execute.handler({ profile: E2E_PROFILE, sql: 'INSERT INTO users (name, age) VALUES (?, ?)', params: ['zoe', 22] });
      expect(ins.structuredContent.affectedRows).toBe(1);
      const chk = await server.tools.query.handler({ profile: E2E_PROFILE, sql: 'SELECT COUNT(*) as cnt FROM users WHERE name=?', params: ['zoe'] });
      expect(chk.structuredContent.rows[0].cnt ?? chk.structuredContent.rows[0].CNT).toBe(1);
    } finally {
      await cleanup();
    }
  });
});
