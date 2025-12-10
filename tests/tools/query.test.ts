import { describe, it, expect, vi } from 'vitest';
import { registerQueryTool, queryInput, queryOutput } from '../../src/tools/query.js';

class FakeServer {
  public tools: Record<string, any> = {};
  registerTool(name: string, meta: any, handler: any) {
    this.tools[name] = { meta, handler };
  }
}

describe('tools/query', () => {
  it('registers tool and queries with defaults applied', async () => {
    const server = new FakeServer();
    const db = { queryRows: vi.fn().mockResolvedValue({ rows: [], columns: [], truncated: false, elapsedMs: 1 }) } as any;
    registerQueryTool(server as any, db, { maxRows: 999, timeoutMs: 777 });

    expect(server.tools.query.meta.description).toMatch('Execute a SELECT query');
    expect(() => queryInput.parse({ sql: 'SELECT 1' })).not.toThrow();
    expect(() => queryOutput.parse({ rows: [], columns: [], truncated: false, elapsedMs: 0 })).not.toThrow();

    const res = await server.tools.query.handler({ sql: 'SELECT * FROM t' });
    expect(db.queryRows).toHaveBeenCalledWith('SELECT * FROM t', [], { maxRows: 999, timeoutMs: 777 });
    expect(res.structuredContent.elapsedMs).toBe(1);
  });

  it('passes provided params/maxRows/timeoutMs', async () => {
    const server = new FakeServer();
    const db = { queryRows: vi.fn().mockResolvedValue({ rows: [1], columns: [], truncated: false, elapsedMs: 1 }) } as any;
    registerQueryTool(server as any, db, { maxRows: 1, timeoutMs: 2 });
    await server.tools.query.handler({ sql: 'SELECT ? as x', params: [5], maxRows: 10, timeoutMs: 20 });
    expect(db.queryRows).toHaveBeenCalledWith('SELECT ? as x', [5], { maxRows: 10, timeoutMs: 20 });
  });
});
