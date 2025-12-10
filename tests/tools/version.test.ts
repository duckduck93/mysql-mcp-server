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
});
