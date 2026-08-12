import { describe, it, expect, vi } from 'vitest';
import { registerExplainTool, buildExplainInput, explainOutput } from '../../src/tools/explain.js';

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

describe('tools/explain', () => {
  it('profile 과 sql 을 필수로 받는다', () => {
    const input = buildExplainInput(CHOICES);
    expect(() => input.parse({ sql: 'SELECT 1' })).toThrow();
    expect(() => input.parse({ profile: 'dev', sql: 'SELECT 1' })).not.toThrow();
  });

  it('registers and returns plan', async () => {
    const server = new FakeServer();
    const plan = [{ id: 1 }];
    const db = { explain: vi.fn().mockResolvedValue(plan) } as any;
    registerExplainTool(server as any, db, { choices: CHOICES });

    expect(server.tools.explain.meta.description).toMatch('execution plan');
    expect(() => explainOutput.parse({ plan })).not.toThrow();

    const res = await server.tools.explain.handler({ profile: 'dev', sql: 'SELECT 1' });
    expect(db.explain).toHaveBeenCalledWith({ profile: 'dev', sql: 'SELECT 1', params: [] });
    expect(res.structuredContent).toEqual({ plan });
  });

  it('passes params through', async () => {
    const server = new FakeServer();
    const db = { explain: vi.fn().mockResolvedValue([]) } as any;
    registerExplainTool(server as any, db, { choices: CHOICES });
    await server.tools.explain.handler({ profile: 'prod', sql: 'SELECT ?', params: [1] });
    expect(db.explain).toHaveBeenCalledWith({ profile: 'prod', sql: 'SELECT ?', params: [1] });
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { explain: vi.fn().mockRejectedValue(new Error('ex-fail')) } as any;
    registerExplainTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.explain.handler({ profile: 'dev', sql: 'SELECT 9' })).rejects.toThrow('ex-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool explain failed');
    expect(log).toContain('SELECT 9');
    spy.mockRestore();
  });

  it('rethrows non-Error and logs with coerced message', async () => {
    const server = new FakeServer();
    const db = { explain: vi.fn().mockRejectedValue(false) } as any;
    registerExplainTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.explain.handler({ profile: 'dev', sql: 'SELECT 8' })).rejects.toBe(false);
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool explain failed');
    spy.mockRestore();
  });
});
