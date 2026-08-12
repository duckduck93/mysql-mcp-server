import { describe, it, expect, vi } from 'vitest';
import { registerShowIndexesTool, buildShowIndexesInput, showIndexesOutput } from '../../src/tools/show_indexes.js';

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

describe('tools/show_indexes', () => {
  const payload = { table: 't', indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true }] };

  it('profile 과 table 을 필수로 받는다', () => {
    const input = buildShowIndexesInput(CHOICES);
    expect(() => input.parse({ table: 't' })).toThrow();
    expect(() => input.parse({ profile: 'dev', table: 't' })).not.toThrow();
  });

  it('registers and lists indexes', async () => {
    const server = new FakeServer();
    const db = { showIndexes: vi.fn().mockResolvedValue(payload) } as any;
    registerShowIndexesTool(server as any, db, { choices: CHOICES });

    expect(server.tools.show_indexes.meta.description).toMatch('Show index definitions');
    expect(() => showIndexesOutput.parse(payload)).not.toThrow();

    const res = await server.tools.show_indexes.handler({ profile: 'dev', table: 't' });
    expect(db.showIndexes).toHaveBeenCalledWith({ profile: 'dev', table: 't' });
    expect(res.structuredContent).toEqual(payload);
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { showIndexes: vi.fn().mockRejectedValue(new Error('si-fail')) } as any;
    registerShowIndexesTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.show_indexes.handler({ profile: 'dev', table: 'z' })).rejects.toThrow('si-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool show_indexes failed');
    expect(log).toContain('z');
    spy.mockRestore();
  });

  it('rethrows non-Error and logs with coerced message', async () => {
    const server = new FakeServer();
    const db = { showIndexes: vi.fn().mockRejectedValue(0) } as any;
    registerShowIndexesTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.show_indexes.handler({ profile: 'dev', table: 'w' })).rejects.toBe(0);
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool show_indexes failed');
    spy.mockRestore();
  });
});
