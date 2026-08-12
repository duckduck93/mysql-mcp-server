import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as mysqlModule from 'mysql2/promise';
import { ConnectionPools } from '../src/connection-pools.js';
import { Profile } from '../src/profile.js';
import type { AppConfig } from '../src/config.js';

vi.mock('mysql2/promise', () => {
  const make = () => ({ execute: vi.fn(), end: vi.fn().mockResolvedValue(undefined) });
  return { default: { createPool: vi.fn(() => make()) } };
});

const cfg = {
  MYSQL_CONNECT_TIMEOUT_MS: 10000, MYSQL_QUERY_TIMEOUT_MS: 60000, MYSQL_POOL_MAX: 10,
} as unknown as AppConfig & { ssl?: any };

const profileOf = (name: string, overrides: Record<string, unknown> = {}) =>
  Profile.from({
    name,
    raw: {
      host: 'h', port: 3306, database: 'd', user: 'u',
      enabled: true, readonly: false, maxRows: 100, production: false, description: 'x',
      ...overrides,
    },
  });

function resolverOf(password = 'pw') {
  return { resolve: vi.fn().mockResolvedValue(password) };
}

describe('ConnectionPools', () => {
  const { createPool } = mysqlModule.default as any;
  beforeEach(() => (createPool as any).mockClear());

  it('프로파일마다 풀을 따로 만든다', async () => {
    const secrets = resolverOf();
    const pools = new ConnectionPools({ cfg, secrets });
    const a = await pools.acquire(profileOf('dev'));
    const b = await pools.acquire(profileOf('prod', { user: 'other' }));
    expect(a).not.toBe(b);
    expect(createPool).toHaveBeenCalledTimes(2);
    await pools.closeAll();
  });

  it('같은 프로파일을 다시 달라고 하면 만들어 둔 풀을 준다', async () => {
    const secrets = resolverOf();
    const pools = new ConnectionPools({ cfg, secrets });
    const first = await pools.acquire(profileOf('dev'));
    const again = await pools.acquire(profileOf('dev'));
    expect(again).toBe(first);
    expect(secrets.resolve).toHaveBeenCalledTimes(1);
    await pools.closeAll();
  });

  it('접속 자격이 바뀌면 풀을 다시 만든다', async () => {
    const secrets = resolverOf();
    const pools = new ConnectionPools({ cfg, secrets });
    await pools.acquire(profileOf('dev'));
    await pools.acquire(profileOf('dev', { user: 'changed' }));
    expect(createPool).toHaveBeenCalledTimes(2);
    await pools.closeAll();
  });

  it('동시에 들어와도 풀을 하나만 만든다', async () => {
    const secrets = resolverOf();
    const pools = new ConnectionPools({ cfg, secrets });
    await Promise.all([
      pools.acquire(profileOf('dev')),
      pools.acquire(profileOf('dev')),
      pools.acquire(profileOf('dev')),
    ]);
    expect(createPool).toHaveBeenCalledTimes(1);
    await pools.closeAll();
  });

  it('비밀번호를 프로파일이 가리키는 위치에서 꺼낸다', async () => {
    const secrets = resolverOf('secret-value');
    const pools = new ConnectionPools({ cfg, secrets });
    await pools.acquire(profileOf('dev'));
    expect(secrets.resolve.mock.calls[0][0].service).toBe('mysql-mcp/dev');
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({ password: 'secret-value' }));
    await pools.closeAll();
  });

  it('만들기에 실패하면 캐시하지 않아 다음 호출이 다시 시도한다', async () => {
    const secrets = { resolve: vi.fn() } as any;
    secrets.resolve.mockRejectedValueOnce(new Error('항목 없음')).mockResolvedValueOnce('pw');
    const pools = new ConnectionPools({ cfg, secrets });

    await expect(pools.acquire(profileOf('dev'))).rejects.toThrow('항목 없음');
    await expect(pools.acquire(profileOf('dev'))).resolves.toBeDefined();
    expect(createPool).toHaveBeenCalledTimes(1);
    await pools.closeAll();
  });

  it('closeAll 은 만들어 둔 풀을 모두 닫는다', async () => {
    const pools = new ConnectionPools({ cfg, secrets: resolverOf() });
    const a = await pools.acquire(profileOf('dev'));
    const b = await pools.acquire(profileOf('prod', { user: 'other' }));
    await pools.closeAll();
    expect((a as any).end).toHaveBeenCalled();
    expect((b as any).end).toHaveBeenCalled();
  });

  it('한 번도 쓰지 않고 닫아도 문제가 없다', async () => {
    await expect(new ConnectionPools({ cfg, secrets: resolverOf() }).closeAll()).resolves.toBeUndefined();
  });
});
