import { describe, it, expect, vi } from 'vitest';
import { registerExecuteTool, executeInput, executeOutput } from '../../src/tools/execute.js';

class FakeServer {
  public tools: Record<string, any> = {};
  registerTool(name: string, meta: any, handler: any) {
    this.tools[name] = { meta, handler };
  }
}

describe('tools/execute', () => {
  it('registers tool and calls db.execute with defaults', async () => {
    const server = new FakeServer();
    const db = { execute: vi.fn().mockResolvedValue({ affectedRows: 1, elapsedMs: 2 }) } as any;
    registerExecuteTool(server as any, db, { timeoutMs: 1234 });

    expect(server.tools.execute.meta.description).toMatch('Execute a non-SELECT SQL');
    expect(() => executeInput.parse({ sql: 'UPDATE t SET a=1' })).not.toThrow();
    expect(() => executeOutput.parse({ affectedRows: 0, elapsedMs: 0 })).not.toThrow();

    const result = await server.tools.execute.handler({ sql: 'UPDATE t SET a=1' });
    expect(db.execute).toHaveBeenCalledWith('UPDATE t SET a=1', [], { timeoutMs: 1234 });
    expect(result.structuredContent).toEqual({ affectedRows: 1, elapsedMs: 2 });
    expect(result.content[0].type).toBe('text');
  });

  it('passes provided params and timeoutMs', async () => {
    const server = new FakeServer();
    const db = { execute: vi.fn().mockResolvedValue({ affectedRows: 1, elapsedMs: 2 }) } as any;
    registerExecuteTool(server as any, db, { timeoutMs: 111 });
    await server.tools.execute.handler({ sql: 'DELETE FROM t WHERE id=?', params: [5], timeoutMs: 9 });
    expect(db.execute).toHaveBeenCalledWith('DELETE FROM t WHERE id=?', [5], { timeoutMs: 9 });
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { execute: vi.fn().mockRejectedValue(new Error('boom')) } as any;
    registerExecuteTool(server as any, db, { timeoutMs: 500 });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.execute.handler({ sql: 'UPDATE t SET a=1' })).rejects.toThrow('boom');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool execute failed');
    expect(log).toContain('UPDATE t SET a=1');
    spy.mockRestore();
  });
});
