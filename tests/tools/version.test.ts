import { describe, it, expect, vi } from 'vitest';
import { registerVersionTool, versionOutput } from '../../src/tools/version.js';

class FakeServer {
  public tools: Record<string, any> = {};
  registerTool(name: string, meta: any, handler: any) {
    this.tools[name] = { meta, handler };
  }
}

describe('tools/version', () => {
  it('registers and returns version', async () => {
    const server = new FakeServer();
    const db = { version: vi.fn().mockResolvedValue({ version: '8.0.x' }) } as any;
    registerVersionTool(server as any, db);

    expect(server.tools.version.meta.description).toMatch('version string');
    expect(() => versionOutput.parse({ version: 'x' })).not.toThrow();

    const res = await server.tools.version.handler({});
    expect(db.version).toHaveBeenCalled();
    expect(res.structuredContent).toEqual({ version: '8.0.x' });
  });

  it('logs to stderr and rethrows on error', async () => {
    const server = new FakeServer();
    const db = { version: vi.fn().mockRejectedValue(new Error('v-fail')) } as any;
    registerVersionTool(server as any, db);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);
    await expect(server.tools.version.handler({})).rejects.toThrow('v-fail');
    const log = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(log).toContain('tool version failed');
    spy.mockRestore();
  });
});
