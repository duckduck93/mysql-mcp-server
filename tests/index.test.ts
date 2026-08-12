import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks
const registerSpies: Record<string, any> = {};

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(() => ({
    MYSQL_SECRET_SOURCE: 'env',
    MYSQL_SSL: 'off', MYSQL_CONNECT_TIMEOUT_MS: 10000, MYSQL_QUERY_TIMEOUT_MS: 60000,
    MYSQL_POOL_MIN: 0, MYSQL_POOL_MAX: 10, LOG_LEVEL: 'silent',
  })),
}));

const CHOICES = [
  { name: 'dev', description: '개발' },
  { name: 'prod', description: '운영' },
];
const registryChoices = vi.fn(() => CHOICES);
vi.mock('../src/profile-registry.js', () => ({
  ProfileRegistry: {
    atPath: vi.fn(() => ({ choices: registryChoices })),
    defaultPath: vi.fn(() => '/tmp/profiles.json'),
  },
}));

vi.mock('../src/connection-pools.js', () => ({
  ConnectionPools: class { constructor(public deps: any) {} },
}));

const dbClose = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/db.js', () => ({
  createDatabase: vi.fn(() => ({ close: dbClose })),
}));

function makeRegistrar(name: string) {
  const fn = vi.fn();
  registerSpies[name] = fn;
  return { [name]: fn };
}

vi.mock('../src/tools/profiles.js', () => makeRegistrar('registerProfilesTool'));
vi.mock('../src/tools/query.js', () => makeRegistrar('registerQueryTool'));
vi.mock('../src/tools/execute.js', () => makeRegistrar('registerExecuteTool'));
vi.mock('../src/tools/show_tables.js', () => makeRegistrar('registerShowTablesTool'));
vi.mock('../src/tools/describe_table.js', () => makeRegistrar('registerDescribeTableTool'));
vi.mock('../src/tools/show_indexes.js', () => makeRegistrar('registerShowIndexesTool'));
vi.mock('../src/tools/explain.js', () => makeRegistrar('registerExplainTool'));
vi.mock('../src/tools/version.js', () => makeRegistrar('registerVersionTool'));

const connectSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    name: string; version: string;
    constructor(opts: any) { this.name = opts.name; this.version = opts.version; }
    connect = connectSpy;
    registerTool = vi.fn();
  }
}));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class { constructor() {} }
}));

// Intercept process.on and exit
const processOn = vi.spyOn(process, 'on').mockImplementation(() => process as any);
const processExit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { /* no-op */ }) as any);
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('index.ts bootstrap', () => {
  beforeEach(() => {
    Object.values(registerSpies).forEach((s: any) => s.mockClear());
    connectSpy.mockClear();
    dbClose.mockClear();
    // @ts-ignore vitest provides resetModules similar to jest
    if ((vi as any).resetModules) {
      (vi as any).resetModules();
    }
  });

  it('creates server, registers tools, connects transport and wires shutdown handlers', async () => {
    await import('../src/index.js');

    // All register*Tool functions should be called once
    expect(registerSpies.registerProfilesTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerQueryTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerExecuteTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerShowTablesTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerDescribeTableTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerShowIndexesTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerExplainTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerVersionTool).toHaveBeenCalledTimes(1);

    // 프로파일 후보는 기동 시점에 레지스트리에서 정해져 모든 도구에 실린다
    expect(registryChoices).toHaveBeenCalled();
    for (const name of ['registerQueryTool', 'registerShowTablesTool', 'registerVersionTool']) {
      expect(registerSpies[name]).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.objectContaining({ choices: CHOICES }));
    }

    // 접속정보는 레지스트리에서, 비밀번호는 조회기에서 접속 시점에 온다
    const { createDatabase } = await import('../src/db.js');
    expect(createDatabase).toHaveBeenCalledWith(expect.objectContaining({
      registry: expect.anything(),
      pools: expect.anything(),
    }));

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(processOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    const sigintHandler = (processOn.mock.calls.find(c => c[0] === 'SIGINT') as any)[1];
    await sigintHandler();
    expect(dbClose).toHaveBeenCalled();
    expect(processExit).toHaveBeenCalledWith(0);
    expect(consoleError).toHaveBeenCalled();
  });

  it('handles fatal error path and exits with code 1', async () => {
    connectSpy.mockRejectedValueOnce(new Error('boom'));
    await import('../src/index.js');
    expect(processExit).toHaveBeenCalledWith(1);
    expect(consoleError).toHaveBeenCalled();
  });
});
