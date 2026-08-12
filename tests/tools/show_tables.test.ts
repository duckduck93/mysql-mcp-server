import { describe, it, expect, vi } from 'vitest';
import { registerShowTablesTool, buildShowTablesInput, showTablesOutput } from '../../src/tools/show_tables.js';

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

describe('tools/show_tables', () => {
  it('profile 을 필수로 받는다', () => {
    const input = buildShowTablesInput(CHOICES);
    expect(() => input.parse({})).toThrow();
    expect(() => input.parse({ profile: 'dev' })).not.toThrow();
  });

  it('registers and lists tables; includeViews default false', async () => {
    const server = new FakeServer();
    const rows = [{ name: 'A', type: 'BASE TABLE' as const }];
    const db = { showTables: vi.fn().mockResolvedValue(rows) } as any;
    registerShowTablesTool(server as any, db, { choices: CHOICES });

    expect(server.tools.show_tables.meta.description).toMatch('List tables');
    expect(() => showTablesOutput.parse({ tables: rows })).not.toThrow();

    const res = await server.tools.show_tables.handler({ profile: 'dev' });
    expect(db.showTables).toHaveBeenCalledWith({ profile: 'dev', includeViews: false });
    expect(res.structuredContent).toEqual({ tables: rows });
  });

  it('passes includeViews true', async () => {
    const server = new FakeServer();
    const db = { showTables: vi.fn().mockResolvedValue([]) } as any;
    registerShowTablesTool(server as any, db, { choices: CHOICES });
    await server.tools.show_tables.handler({ profile: 'prod', includeViews: true });
    expect(db.showTables).toHaveBeenCalledWith({ profile: 'prod', includeViews: true });
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { showTables: vi.fn().mockRejectedValue(new Error('st-fail')) } as any;
    registerShowTablesTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.show_tables.handler({ profile: 'dev', includeViews: true })).rejects.toThrow('st-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool show_tables failed');
    expect(log).toContain('includeViews');
    spy.mockRestore();
  });

  it('logs mysql error details and uses sqlMessage when message is empty', async () => {
    const server = new FakeServer();
    const err: any = { message: '', code: 'ER_ACCESS_DENIED', errno: 1045, sqlState: '28000', sqlMessage: 'Access denied' };
    const db = { showTables: vi.fn().mockRejectedValue(err) } as any;
    registerShowTablesTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.show_tables.handler({ profile: 'dev' })).rejects.toBe(err);
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('Access denied');
    expect(log).toContain('ER_ACCESS_DENIED');
    expect(log).toContain('details');
    spy.mockRestore();
  });

  it('rethrows non-Error and logs with coerced message', async () => {
    const server = new FakeServer();
    const db = { showTables: vi.fn().mockRejectedValue('bad') } as any;
    registerShowTablesTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.show_tables.handler({ profile: 'dev', includeViews: false })).rejects.toBe('bad');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool show_tables failed');
    spy.mockRestore();
  });

  it('covers details collection for each mysql error field individually', async () => {
    const keys = ['code', 'errno', 'sql', 'sqlState', 'sqlMessage'] as const;
    for (const k of keys) {
      const server = new FakeServer();
      const err: any = { message: '' };
      err[k] = `X_${k}`;
      const db = { showTables: vi.fn().mockRejectedValue(err) } as any;
      registerShowTablesTool(server as any, db, { choices: CHOICES });
      const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
      await expect(server.tools.show_tables.handler({ profile: 'dev', includeViews: false })).rejects.toBe(err);
      const log = spy.mock.calls.map((c) => String(c[0])).join('');
      expect(log).toContain('details');
      expect(log).toContain(`X_${k}`);
      spy.mockRestore();
    }
  });
});
