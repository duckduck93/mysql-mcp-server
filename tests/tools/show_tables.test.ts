import { describe, it, expect, vi } from 'vitest';
import { registerShowTablesTool, showTablesInput, showTablesOutput } from '../../src/tools/show_tables.js';

class FakeServer {
  public tools: Record<string, any> = {};
  registerTool(name: string, meta: any, handler: any) {
    this.tools[name] = { meta, handler };
  }
}

describe('tools/show_tables', () => {
  it('registers and lists tables; includeViews default false', async () => {
    const server = new FakeServer();
    const rows = [{ name: 'A', type: 'BASE TABLE' as const }];
    const db = { showTables: vi.fn().mockResolvedValue(rows) } as any;
    registerShowTablesTool(server as any, db);

    expect(server.tools.show_tables.meta.description).toMatch('List tables');
    expect(() => showTablesInput.parse({})).not.toThrow();
    expect(() => showTablesOutput.parse({ tables: rows })).not.toThrow();

    const res = await server.tools.show_tables.handler({});
    expect(db.showTables).toHaveBeenCalledWith(false);
    expect(res.structuredContent).toEqual({ tables: rows });
  });

  it('passes includeViews true', async () => {
    const server = new FakeServer();
    const db = { showTables: vi.fn().mockResolvedValue([]) } as any;
    registerShowTablesTool(server as any, db);
    await server.tools.show_tables.handler({ includeViews: true });
    expect(db.showTables).toHaveBeenCalledWith(true);
  });
});
