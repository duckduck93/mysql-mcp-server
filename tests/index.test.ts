import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks
const registerSpies: Record<string, any> = {};

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(() => ({
    MYSQL_HOST: 'h', MYSQL_PORT: 3306, MYSQL_USER: 'u', MYSQL_DATABASE: 'd', MYSQL_PROFILE: 'testprofile',
    MYSQL_SECRET_SOURCE: 'env',
    MYSQL_SSL: 'off', MYSQL_CONNECT_TIMEOUT_MS: 10000, MYSQL_QUERY_TIMEOUT_MS: 60000, MYSQL_POOL_MIN: 0, MYSQL_POOL_MAX: 10,
    MAX_ROWS: 10000, LOG_LEVEL: 'silent',
  })),
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
    // reset spies
    Object.values(registerSpies).forEach((s: any) => s.mockClear());
    connectSpy.mockClear();
    dbClose.mockClear();
    // ensure fresh module execution for each test
    // @ts-ignore vitest provides resetModules similar to jest
    if ((vi as any).resetModules) {
      (vi as any).resetModules();
    }
  });

  it('creates server, registers tools, connects transport and wires shutdown handlers', async () => {
    // Dynamic import triggers main()
    await import('../src/index.js');

    // All register*Tool functions should be called once
    expect(registerSpies.registerQueryTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerExecuteTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerShowTablesTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerDescribeTableTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerShowIndexesTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerExplainTool).toHaveBeenCalledTimes(1);
    expect(registerSpies.registerVersionTool).toHaveBeenCalledTimes(1);

    // 비밀번호를 기동 시 환경변수로 받지 않고, 조회기를 받아 접속 시점에 꺼낸다
    const { createDatabase } = await import('../src/db.js');
    expect(createDatabase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resolve: expect.any(Function) }),
    );

    expect(connectSpy).toHaveBeenCalledTimes(1);
    // Two shutdown handlers should be registered
    expect(processOn).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOn).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    // Manually invoke the shutdown handler to ensure db.close is called and process.exit is invoked
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
