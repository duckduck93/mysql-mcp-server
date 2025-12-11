import { describe, it, expect, vi } from 'vitest';
import { registerShowIndexesTool, showIndexesInput, showIndexesOutput } from '../../src/tools/show_indexes.js';

class FakeServer {
  public tools: Record<string, any> = {};
  registerTool(name: string, meta: any, handler: any) {
    this.tools[name] = { meta, handler };
  }
}

describe('tools/show_indexes', () => {
  it('registers and shows indexes', async () => {
    const server = new FakeServer();
    const resObj = { table: 't', indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true }] };
    const db = { showIndexes: vi.fn().mockResolvedValue(resObj) } as any;
    registerShowIndexesTool(server as any, db);

    expect(server.tools.show_indexes.meta.description).toMatch('Show index definitions');
    expect(() => showIndexesInput.parse({ table: 't' })).not.toThrow();
    expect(() => showIndexesOutput.parse(resObj)).not.toThrow();

    const res = await server.tools.show_indexes.handler({ table: 't' });
    expect(db.showIndexes).toHaveBeenCalledWith('t');
    expect(res.structuredContent).toEqual(resObj);
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { showIndexes: vi.fn().mockRejectedValue(new Error('si-fail')) } as any;
    registerShowIndexesTool(server as any, db);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.show_indexes.handler({ table: 't' })).rejects.toThrow('si-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool show_indexes failed');
    expect(log).toContain('"table":"t"');
    spy.mockRestore();
  });
});
