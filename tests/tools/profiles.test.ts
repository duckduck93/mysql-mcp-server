import { describe, it, expect, vi } from 'vitest';
import { registerProfilesTool, profilesOutput } from '../../src/tools/profiles.js';

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

describe('tools/profiles', () => {
  const rows = [
    { name: 'dev', description: '개발', open: true, readonly: false, production: false, maxRows: 100 },
    { name: 'prod', description: '운영', open: false, readonly: true, production: true, maxRows: 10, expiresAt: '2026-08-12T11:00:00.000Z' },
  ];

  it('목록과 열림 상태를 돌려준다', async () => {
    const server = new FakeServer();
    const db = { listProfiles: vi.fn().mockReturnValue(rows) } as any;
    registerProfilesTool(server as any, db);

    expect(server.tools.profiles.meta.description).toMatch('프로파일');
    expect(() => profilesOutput.parse({ profiles: rows })).not.toThrow();

    const res = await server.tools.profiles.handler({});
    expect(res.structuredContent).toEqual({ profiles: rows });
  });

  it('닫힌 프로파일은 사용자가 열어야 한다고 설명에 적혀 있다', () => {
    const server = new FakeServer();
    registerProfilesTool(server as any, { listProfiles: () => [] } as any);
    expect(server.tools.profiles.meta.description).toMatch(/사용자가 열어야/);
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { listProfiles: vi.fn(() => { throw new Error('p-fail'); }) } as any;
    registerProfilesTool(server as any, db);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.profiles.handler({})).rejects.toThrow('p-fail');
    expect(spy.mock.calls.map(c => String(c[0])).join('')).toContain('tool profiles failed');
    spy.mockRestore();
  });

  it('rethrows non-Error and logs with coerced message', async () => {
    const server = new FakeServer();
    const db = { listProfiles: vi.fn(() => { throw 'nope'; }) } as any;
    registerProfilesTool(server as any, db);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.profiles.handler({})).rejects.toBe('nope');
    expect(spy.mock.calls.map(c => String(c[0])).join('')).toContain('tool profiles failed');
    spy.mockRestore();
  });
});
