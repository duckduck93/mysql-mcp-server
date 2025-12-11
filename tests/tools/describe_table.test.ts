import { describe, it, expect, vi } from 'vitest';
import { registerDescribeTableTool, describeTableInput, describeTableOutput } from '../../src/tools/describe_table.js';

class FakeServer {
  public tools: Record<string, any> = {};
  registerTool(name: string, meta: any, handler: any) {
    this.tools[name] = { meta, handler };
  }
}

describe('tools/describe_table', () => {
  it('registers and describes table', async () => {
    const server = new FakeServer();
    const resObj = { table: 't', columns: [{ name: 'id', type: 'int', nullable: false }], tableComment: 'comment' };
    const db = { describeTable: vi.fn().mockResolvedValue(resObj) } as any;
    registerDescribeTableTool(server as any, db);

    expect(server.tools.describe_table.meta.description).toMatch('Describe the schema');
    expect(() => describeTableInput.parse({ table: 't' })).not.toThrow();
    expect(() => describeTableOutput.parse(resObj)).not.toThrow();

    const res = await server.tools.describe_table.handler({ table: 't' });
    expect(db.describeTable).toHaveBeenCalledWith('t');
    expect(res.structuredContent).toEqual(resObj);
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { describeTable: vi.fn().mockRejectedValue(new Error('dt-fail')) } as any;
    registerDescribeTableTool(server as any, db);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.describe_table.handler({ table: 'users' })).rejects.toThrow('dt-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool describe_table failed');
    expect(log).toContain('"table":"users"');
    spy.mockRestore();
  });
});
