import { describe, it, expect, vi } from 'vitest';
import { registerExecuteTool, buildExecuteInput, executeOutput } from '../../src/tools/execute.js';

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

describe('tools/execute', () => {
  it('profile 을 필수로 받는다', () => {
    const input = buildExecuteInput(CHOICES);
    expect(() => input.parse({ sql: 'UPDATE t SET a=1' })).toThrow();
    expect(() => input.parse({ profile: 'dev', sql: 'UPDATE t SET a=1' })).not.toThrow();
  });

  it('registers tool and calls db.execute with defaults', async () => {
    const server = new FakeServer();
    const db = { execute: vi.fn().mockResolvedValue({ affectedRows: 1, elapsedMs: 2 }) } as any;
    registerExecuteTool(server as any, db, { choices: CHOICES, timeoutMs: 1234 });

    expect(server.tools.execute.meta.description).toMatch('Execute a non-SELECT SQL');
    expect(() => executeOutput.parse({ affectedRows: 0, elapsedMs: 0 })).not.toThrow();

    const result = await server.tools.execute.handler({ profile: 'dev', sql: 'UPDATE t SET a=1' });
    expect(db.execute).toHaveBeenCalledWith({ profile: 'dev', sql: 'UPDATE t SET a=1', params: [], timeoutMs: 1234 });
    expect(result.structuredContent).toEqual({ affectedRows: 1, elapsedMs: 2 });
    expect(result.content[0].type).toBe('text');
  });

  it('passes provided params and timeoutMs', async () => {
    const server = new FakeServer();
    const db = { execute: vi.fn().mockResolvedValue({ affectedRows: 1, elapsedMs: 2 }) } as any;
    registerExecuteTool(server as any, db, { choices: CHOICES, timeoutMs: 111 });
    await server.tools.execute.handler({ profile: 'dev', sql: 'DELETE FROM t WHERE id=?', params: [5], timeoutMs: 9 });
    expect(db.execute).toHaveBeenCalledWith({ profile: 'dev', sql: 'DELETE FROM t WHERE id=?', params: [5], timeoutMs: 9 });
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { execute: vi.fn().mockRejectedValue(new Error('boom')) } as any;
    registerExecuteTool(server as any, db, { choices: CHOICES, timeoutMs: 500 });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.execute.handler({ profile: 'dev', sql: 'UPDATE t SET a=1' })).rejects.toThrow('boom');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool execute failed');
    expect(log).toContain('UPDATE t SET a=1');
    spy.mockRestore();
  });

  it('rethrows non-Error and logs with coerced message', async () => {
    const server = new FakeServer();
    const db = { execute: vi.fn().mockRejectedValue(12345) } as any;
    registerExecuteTool(server as any, db, { choices: CHOICES, timeoutMs: 5 });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.execute.handler({ profile: 'dev', sql: 'DELETE FROM t' })).rejects.toBe(12345);
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool execute failed');
    expect(log).toContain('DELETE FROM t');
    spy.mockRestore();
  });
});
