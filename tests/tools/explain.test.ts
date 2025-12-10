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
});
