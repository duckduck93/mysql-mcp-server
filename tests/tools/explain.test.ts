import { describe, it, expect, vi } from 'vitest';
import { registerExplainTool, explainInput, explainOutput } from '../../src/tools/explain.js';

class FakeServer {
  public tools: Record<string, any> = {};
  registerTool(name: string, meta: any, handler: any) {
    this.tools[name] = { meta, handler };
  }
}

describe('tools/explain', () => {
  it('registers and returns plan', async () => {
    const server = new FakeServer();
    const plan = [{ id: 1 }];
    const db = { explain: vi.fn().mockResolvedValue(plan) } as any;
    registerExplainTool(server as any, db);

    expect(server.tools.explain.meta.description).toMatch('execution plan');
    expect(() => explainInput.parse({ sql: 'SELECT 1' })).not.toThrow();
    expect(() => explainOutput.parse({ plan: [] })).not.toThrow();

    const res = await server.tools.explain.handler({ sql: 'SELECT * FROM t', params: [1] });
    expect(db.explain).toHaveBeenCalledWith('SELECT * FROM t', [1]);
    expect(res.structuredContent).toEqual({ plan });
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { explain: vi.fn().mockRejectedValue(new Error('ex-fail')) } as any;
    registerExplainTool(server as any, db);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.explain.handler({ sql: 'SELECT * FROM t', params: [1] })).rejects.toThrow('ex-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool explain failed');
    expect(log).toContain('SELECT * FROM t');
    spy.mockRestore();
  });
});
