import { describe, it, expect, vi } from 'vitest';
import { registerDescribeTableTool, buildDescribeTableInput, describeTableOutput } from '../../src/tools/describe_table.js';

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

describe('tools/describe_table', () => {
  const payload = { table: 't', columns: [{ name: 'id', type: 'int', nullable: false }], tableComment: 'c' };

  it('profile 과 table 을 필수로 받는다', () => {
    const input = buildDescribeTableInput(CHOICES);
    expect(() => input.parse({ table: 't' })).toThrow();
    expect(() => input.parse({ profile: 'dev' })).toThrow();
    expect(() => input.parse({ profile: 'dev', table: 't' })).not.toThrow();
  });

  it('registers and describes table', async () => {
    const server = new FakeServer();
    const db = { describeTable: vi.fn().mockResolvedValue(payload) } as any;
    registerDescribeTableTool(server as any, db, { choices: CHOICES });

    expect(server.tools.describe_table.meta.description).toMatch('Describe the schema');
    expect(() => describeTableOutput.parse(payload)).not.toThrow();

    const res = await server.tools.describe_table.handler({ profile: 'dev', table: 't' });
    expect(db.describeTable).toHaveBeenCalledWith({ profile: 'dev', table: 't' });
    expect(res.structuredContent).toEqual(payload);
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { describeTable: vi.fn().mockRejectedValue(new Error('dt-fail')) } as any;
    registerDescribeTableTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.describe_table.handler({ profile: 'dev', table: 'x' })).rejects.toThrow('dt-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool describe_table failed');
    expect(log).toContain('x');
    spy.mockRestore();
  });

  it('rethrows non-Error and logs with coerced message', async () => {
    const server = new FakeServer();
    const db = { describeTable: vi.fn().mockRejectedValue(undefined) } as any;
    registerDescribeTableTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.describe_table.handler({ profile: 'dev', table: 'y' })).rejects.toBeUndefined();
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool describe_table failed');
    spy.mockRestore();
  });
});
