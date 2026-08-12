import { describe, it, expect, vi } from 'vitest';
import { registerVersionTool, buildVersionInput, versionOutput } from '../../src/tools/version.js';

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

describe('tools/version', () => {
  it('profile 을 필수로 받는다', () => {
    const input = buildVersionInput(CHOICES);
    expect(() => input.parse({})).toThrow();
    expect(() => input.parse({ profile: 'dev' })).not.toThrow();
  });

  it('registers and returns version', async () => {
    const server = new FakeServer();
    const db = { version: vi.fn().mockResolvedValue({ version: '8.0.x' }) } as any;
    registerVersionTool(server as any, db, { choices: CHOICES });

    expect(server.tools.version.meta.description).toMatch('version string');
    expect(() => versionOutput.parse({ version: 'x' })).not.toThrow();

    const res = await server.tools.version.handler({ profile: 'dev' });
    expect(db.version).toHaveBeenCalledWith({ profile: 'dev' });
    expect(res.structuredContent).toEqual({ version: '8.0.x' });
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { version: vi.fn().mockRejectedValue(new Error('v-fail')) } as any;
    registerVersionTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.version.handler({ profile: 'dev' })).rejects.toThrow('v-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool version failed');
    expect(log).toContain('dev');
    spy.mockRestore();
  });

  it('rethrows non-Error and logs with coerced message', async () => {
    const server = new FakeServer();
    const db = { version: vi.fn().mockRejectedValue(null) } as any;
    registerVersionTool(server as any, db, { choices: CHOICES });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.version.handler({ profile: 'dev' })).rejects.toBeNull();
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool version failed');
    spy.mockRestore();
  });
});
