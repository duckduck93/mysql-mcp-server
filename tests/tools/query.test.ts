import { describe, it, expect, vi } from 'vitest';
import { registerQueryTool, buildQueryInput, queryOutput } from '../../src/tools/query.js';

class FakeServer {
  public tools: Record<string, any> = {};
  registerTool(name: string, meta: any, handler: any) {
    this.tools[name] = { meta, handler };
  }
}

const CHOICES = [
  { name: 'dev', description: '개발 DB. 평소 이걸 쓴다' },
  { name: 'prod', description: '운영 DB. 사용자가 열어줄 때만' },
];

describe('tools/query', () => {
  it('profile 을 필수로 받고 기본값을 두지 않는다', () => {
    const input = buildQueryInput(CHOICES);
    expect(() => input.parse({ sql: 'SELECT 1' })).toThrow();
    expect(() => input.parse({ profile: 'dev', sql: 'SELECT 1' })).not.toThrow();
    expect(() => input.parse({ profile: 'nope', sql: 'SELECT 1' })).toThrow();
  });

  it('프로파일 후보의 설명을 인자 설명에 그대로 싣는다', () => {
    const described = (buildQueryInput(CHOICES).shape.profile as any).description as string;
    expect(described).toContain('dev');
    expect(described).toContain('개발 DB. 평소 이걸 쓴다');
    expect(described).toContain('profiles');
  });

  it('registers tool and queries with defaults applied', async () => {
    const server = new FakeServer();
    const db = { queryRows: vi.fn().mockResolvedValue({ rows: [], columns: [], truncated: false, elapsedMs: 1 }) } as any;
    registerQueryTool(server as any, db, { choices: CHOICES, timeoutMs: 777 });

    expect(server.tools.query.meta.description).toMatch('Execute a SELECT query');
    expect(() => queryOutput.parse({ rows: [], columns: [], truncated: false, elapsedMs: 0 })).not.toThrow();

    const res = await server.tools.query.handler({ profile: 'dev', sql: 'SELECT * FROM t' });
    expect(db.queryRows).toHaveBeenCalledWith({ profile: 'dev', sql: 'SELECT * FROM t', params: [], timeoutMs: 777 });
    expect(res.structuredContent.elapsedMs).toBe(1);
  });

  it('maxRows 를 주지 않으면 넘기지 않는다 — 프로파일 상한이 쓰인다', async () => {
    const server = new FakeServer();
    const db = { queryRows: vi.fn().mockResolvedValue({ rows: [], columns: [], truncated: false, elapsedMs: 1 }) } as any;
    registerQueryTool(server as any, db, { choices: CHOICES, timeoutMs: 10 });
    await server.tools.query.handler({ profile: 'dev', sql: 'SELECT 1' });
    expect(db.queryRows.mock.calls[0][0]).not.toHaveProperty('maxRows');
  });

  it('passes provided params/maxRows/timeoutMs', async () => {
    const server = new FakeServer();
    const db = { queryRows: vi.fn().mockResolvedValue({ rows: [1], columns: [], truncated: false, elapsedMs: 1 }) } as any;
    registerQueryTool(server as any, db, { choices: CHOICES, timeoutMs: 2 });
    await server.tools.query.handler({ profile: 'prod', sql: 'SELECT ? as x', params: [5], maxRows: 10, timeoutMs: 20 });
    expect(db.queryRows).toHaveBeenCalledWith({ profile: 'prod', sql: 'SELECT ? as x', params: [5], maxRows: 10, timeoutMs: 20 });
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { queryRows: vi.fn().mockRejectedValue(new Error('q-fail')) } as any;
    registerQueryTool(server as any, db, { choices: CHOICES, timeoutMs: 1000 });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.query.handler({ profile: 'dev', sql: 'SELECT 1' })).rejects.toThrow('q-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool query failed');
    expect(log).toContain('SELECT 1');
    expect(log).toContain('dev');
    spy.mockRestore();
  });

  it('rethrows non-Error and logs with coerced message', async () => {
    const server = new FakeServer();
    const db = { queryRows: vi.fn().mockRejectedValue('string-error') } as any;
    registerQueryTool(server as any, db, { choices: CHOICES, timeoutMs: 20 });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.query.handler({ profile: 'dev', sql: 'SELECT 2' })).rejects.toBe('string-error');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool query failed');
    expect(log).toContain('SELECT 2');
    spy.mockRestore();
  });
});
