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
});
