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
});
