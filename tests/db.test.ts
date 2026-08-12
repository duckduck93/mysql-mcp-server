import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as mysqlModule from 'mysql2/promise';
import { createDatabase, Database } from '../src/db.js';
import { Profile } from '../src/profile.js';
import type { AppConfig } from '../src/config.js';
import type { SecretResolver } from '../src/secret-resolver.js';

vi.mock('mysql2/promise', () => {
  let executeImpl: any;
  const pool = {
    execute: (...args: any[]) => executeImpl?.(...args),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return {
    default: { createPool: vi.fn(() => pool) },
  };
});

const baseCfg: AppConfig & { ssl?: any } = {
  MYSQL_PROFILE: 'dev', MYSQL_SECRET_SOURCE: 'keychain',
  MYSQL_SSL: 'off', MYSQL_CONNECT_TIMEOUT_MS: 10000, MYSQL_QUERY_TIMEOUT_MS: 60000,
  MYSQL_POOL_MIN: 0, MYSQL_POOL_MAX: 10, LOG_LEVEL: 'silent',
} as any;

const rawProfile = (overrides: Record<string, unknown> = {}) => ({
  host: 'h', port: 3306, database: 'd', user: 'u',
  enabled: true, readonly: false, maxRows: 100,
  description: '테스트용',
  ...overrides,
});

/** 내용을 갈아끼울 수 있는 가짜 레지스트리. get 호출 횟수를 센다. */
function fakeRegistry(initial: Record<string, unknown> = rawProfile()) {
  const state = { raw: initial, gets: 0 };
  const registry = {
    get(name: string) {
      state.gets++;
      return Profile.from({ name, raw: state.raw });
    },
    names: () => ['dev'],
    choices: () => [],
  } as any;
  return {
    registry,
    get gets() { return state.gets; },
    replaceWith(raw: Record<string, unknown>) { state.raw = raw; },
  };
}

function fakeResolver(password = 'pw-from-keychain'): SecretResolver & { resolve: ReturnType<typeof vi.fn> } {
  return { resolve: vi.fn().mockResolvedValue(password) } as any;
}

function makeDb(opts: {
  raw?: Record<string, unknown>;
  secrets?: SecretResolver;
} = {}) {
  const reg = fakeRegistry(opts.raw ?? rawProfile());
  const secrets = opts.secrets ?? fakeResolver();
  const db = createDatabase({ registry: reg.registry, profileName: 'dev', cfg: baseCfg, secrets });
  return { db, reg, secrets: secrets as any };
}

function setExecuteImpl(fn: any) {
  // @ts-ignore
  (mysqlModule.default.createPool as any)().execute = fn;
}

describe('db.ts', () => {
  let db: Database;
  beforeEach(() => {
    vi.useFakeTimers();
    db = makeDb().db;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await db.close();
  });

  it('queryRows returns rows, columns, truncated and measures elapsed', async () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const fields = [{ name: 'a', type: 3 }];
    setExecuteImpl(vi.fn().mockResolvedValue([rows, fields]));
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1005);
    const res = await db.queryRows('SELECT 1', [], { maxRows: 2 });
    expect(res.columns).toEqual([{ name: 'a', type: '3' }]);
    expect(res.rows).toEqual(rows.slice(0, 2));
    expect(res.truncated).toBe(true);
    expect(res.elapsedMs).toBe(5);
  });

  it('queryRows resolves before timeout (covers withTimeout resolve path)', async () => {
    const rows = [{ a: 1 }];
    const fields = [{ name: 'a', type: 3 }];
    setExecuteImpl(vi.fn().mockResolvedValue([rows, fields]));
    const res = await db.queryRows('SELECT 1', [], { timeoutMs: 1000 });
    expect(res.rows).toEqual(rows);
  });

  it('queryRows handles undefined fields and no truncation', async () => {
    const rows = [{ a: 1 }];
    setExecuteImpl(vi.fn().mockResolvedValue([rows, undefined]));
    const res = await db.queryRows('SELECT 1');
    expect(res.columns).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it('queryRows timeout rejects with proper message', async () => {
    setExecuteImpl(vi.fn().mockImplementation(() => new Promise(() => {})));
    const p = db.queryRows('SELECT SLEEP(5)', [], { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    await expect(p).rejects.toThrow('query timed out after 50ms');
  });

  it('execute returns affectedRows, insertId, warningStatus and elapsedMs', async () => {
    const result = { affectedRows: 2, insertId: 7, warningStatus: 0 };
    setExecuteImpl(vi.fn().mockResolvedValue([result]));
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(3);
    const res = await db.execute('UPDATE x SET a=1');
    expect(res).toEqual({ affectedRows: 2, insertId: 7, warningStatus: 0, elapsedMs: 3 });
  });

  it('execute resolves before timeout (covers withTimeout resolve path)', async () => {
    const result = { affectedRows: 1, insertId: 0, warningStatus: 0 };
    setExecuteImpl(vi.fn().mockResolvedValue([result]));
    const res = await db.execute('UPDATE x SET a=1', [], { timeoutMs: 1000 });
    expect(res.affectedRows).toBe(1);
  });

  it('execute timeout rejects', async () => {
    setExecuteImpl(vi.fn().mockImplementation(() => new Promise(() => {})));
    const p = db.execute('UPDATE slow', [], { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(11);
    await expect(p).rejects.toThrow('execute timed out after 10ms');
  });

  it('showTables delegates to queryRows and returns typed list', async () => {
    setExecuteImpl(vi.fn().mockResolvedValue([[
      { name: 'A', type: 'BASE TABLE' },
      { name: 'V', type: 'VIEW' },
    ], [{ name: 'name' }]]));
    const list = await db.showTables(true);
    expect(list).toEqual([
      { name: 'A', type: 'BASE TABLE' },
      { name: 'V', type: 'VIEW' },
    ]);
  });

  it('describeTable merges columns and table comment', async () => {
    let call = 0;
    setExecuteImpl(vi.fn().mockImplementation((sql: string) => {
      call++;
      if (call === 1) return Promise.resolve([[ [{ name: 'id', type: 'int', nullable: false }], [{ name: 'name' }] ][0]]);
      return Promise.resolve([[ [{ comment: 't-comment' }], [{ name: 'TABLE_COMMENT' }] ][0]]);
    }));
    const res = await db.describeTable('t');
    expect(res.table).toBe('t');
    expect(Array.isArray(res.columns)).toBe(true);
    expect(res.tableComment).toBe('t-comment');
  });

  it('describeTable converts numeric nullable to boolean', async () => {
    let call = 0;
    setExecuteImpl(vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([[{ name: 'n', type: 'varchar', nullable: 1 }], []]);
      return Promise.resolve([[{ comment: '' }], []]);
    }));
    const res = await db.describeTable('t2');
    expect(res.columns[0].nullable).toBe(true);
  });

  it('showIndexes groups by index name and maps fields', async () => {
    const stats = [
      { name: 'PRIMARY', seq: 1, col: 'id', nonUnique: 0, comment: null, type: 'BTREE', visible: 'YES' },
      { name: 'idx_a', seq: 1, col: 'a', nonUnique: 1, comment: 'c', type: 'BTREE', visible: 'NO' },
      { name: 'idx_a', seq: 2, col: 'b', nonUnique: 1, comment: 'c', type: 'BTREE', visible: 'NO' },
    ];
    setExecuteImpl(vi.fn().mockResolvedValue([[stats], [{ name: 'INDEX_NAME' }]]));
    const res = await db.showIndexes('t');
    expect(res.table).toBe('t');
    const primary = res.indexes.find(i => i.name === 'PRIMARY')!;
    expect(primary.columns).toEqual(['id']);
    expect(primary.unique).toBe(true);
    const idxA = res.indexes.find(i => i.name === 'idx_a')!;
    expect(idxA.columns).toEqual(['a', 'b']);
    expect(idxA.unique).toBe(false);
    expect(idxA.visible).toBe(false);
    expect(idxA.comment).toBe('c');
    expect(idxA.type).toBe('BTREE');
  });

  it('showIndexes handles non-nested rows path', async () => {
    const stats = [
      { name: 'ix', seq: 1, col: 'c1', nonUnique: 1, comment: '', type: 'BTREE', visible: 'YES' },
    ];
    setExecuteImpl(vi.fn().mockResolvedValue([stats, []]));
    const res = await db.showIndexes('t3');
    expect(res.indexes[0].columns).toEqual(['c1']);
  });

  it('explain returns plan rows', async () => {
    const plan = [{ id: 1 }];
    setExecuteImpl(vi.fn().mockResolvedValue([[plan], []]));
    const res = await db.explain('SELECT 1');
    expect(res).toEqual(plan);
  });

  it('explain handles non-nested rows path', async () => {
    const plan = [{ id: 2 }];
    setExecuteImpl(vi.fn().mockResolvedValue([plan, []]));
    const res = await db.explain('SELECT 2');
    expect(res).toEqual(plan);
  });

  it('version selects version field', async () => {
    setExecuteImpl(vi.fn().mockResolvedValue([[ [{ version: '8.0.x' }], [] ][0]]));
    const res = await db.version();
    expect(res).toEqual({ version: '8.0.x' });
  });
});

describe('db.ts — 접속정보와 비밀번호는 프로파일에서 온다', () => {
  const { createPool } = mysqlModule.default as any;

  beforeEach(() => {
    setExecuteImpl(vi.fn().mockResolvedValue([[{ version: '8' }], []]));
    (createPool as any).mockClear();
  });

  it('생성만으로는 풀도 만들지 않고 비밀번호도 꺼내지 않는다', () => {
    const { reg, secrets } = makeDb();
    expect(secrets.resolve).not.toHaveBeenCalled();
    expect(createPool).not.toHaveBeenCalled();
    expect(reg.gets).toBe(0);
  });

  it('프로파일의 접속정보와 Keychain 비밀번호로 풀을 만든다', async () => {
    const { db, secrets } = makeDb();
    await db.version();

    expect(secrets.resolve.mock.calls[0][0].service).toBe('mysql-mcp/dev');
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({
      host: 'h', port: 3306, user: 'u', database: 'd', password: 'pw-from-keychain',
    }));
    await db.close();
  });

  it('호출할 때마다 프로파일을 다시 읽는다', async () => {
    const { db, reg } = makeDb();
    await db.version();
    await db.version();
    expect(reg.gets).toBe(2);
    expect(createPool).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it('접속 자격이 그대로면 풀을 재사용한다', async () => {
    const { db, secrets } = makeDb();
    await db.version();
    await db.version();
    expect(secrets.resolve).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it('프로파일의 접속 자격이 바뀌면 풀을 다시 만든다', async () => {
    const { db, reg, secrets } = makeDb();
    await db.version();
    reg.replaceWith(rawProfile({ user: 'other' }));
    await db.version();
    expect(createPool).toHaveBeenCalledTimes(2);
    expect(secrets.resolve).toHaveBeenCalledTimes(2);
    await db.close();
  });

  it('비밀번호 조회 실패는 그대로 올라오고, 등록 뒤 재시도는 재시작 없이 통과한다', async () => {
    const secrets = { resolve: vi.fn() } as any;
    secrets.resolve.mockRejectedValueOnce(new Error('항목 없음')).mockResolvedValueOnce('pw');
    const { db } = makeDb({ secrets });

    await expect(db.version()).rejects.toThrow('항목 없음');
    expect(createPool).not.toHaveBeenCalled();

    await expect(db.version()).resolves.toEqual({ version: '8' });
    expect(createPool).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it('한 번도 쓰지 않은 채 닫으면 아무 것도 하지 않는다', async () => {
    const { db, secrets } = makeDb();
    await db.close();
    expect(secrets.resolve).not.toHaveBeenCalled();
    expect(createPool).not.toHaveBeenCalled();
  });

  it('timezone·charset 설정을 mysql2 에 넘긴다', async () => {
    const reg = fakeRegistry(rawProfile());
    const db = createDatabase({
      registry: reg.registry, profileName: 'dev', secrets: fakeResolver(),
      cfg: { ...baseCfg, MYSQL_TIMEZONE: '+00:00', MYSQL_CHARSET: 'utf8mb4' } as any,
    });
    await db.version();
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({ timezone: '+00:00', charset: 'utf8mb4' }));
    await db.close();
  });
});

describe('db.ts — 게이트는 호출 시점에 걸린다', () => {
  beforeEach(() => {
    setExecuteImpl(vi.fn().mockResolvedValue([[{ version: '8' }], []]));
  });

  it('닫힌 프로파일은 조회를 거부한다', async () => {
    const { db } = makeDb({ raw: rawProfile({ enabled: false }) });
    await expect(db.version()).rejects.toThrow(/사용자/);
  });

  it('열려 있다가 닫히면 다음 호출부터 거부된다 — 재시작이 필요 없다', async () => {
    const { db, reg } = makeDb();
    await expect(db.version()).resolves.toEqual({ version: '8' });

    reg.replaceWith(rawProfile({ enabled: false }));
    await expect(db.version()).rejects.toThrow(/닫혀/);
    await db.close();
  });

  it('만료된 프로파일은 거부한다', async () => {
    const { db } = makeDb({ raw: rawProfile({ enabled: undefined, enabledUntil: '2000-01-01T00:00:00Z' }) });
    await expect(db.version()).rejects.toThrow(/만료/);
  });

  it('닫힌 프로파일에는 붙지도 않는다', async () => {
    const { createPool } = mysqlModule.default as any;
    (createPool as any).mockClear();
    const { db, secrets } = makeDb({ raw: rawProfile({ enabled: false }) });
    await db.version().catch(() => {});
    expect(createPool).not.toHaveBeenCalled();
    expect(secrets.resolve).not.toHaveBeenCalled();
  });

  it('readonly 프로파일은 쓰기를 거부한다', async () => {
    const { db } = makeDb({ raw: rawProfile({ readonly: true }) });
    await expect(db.execute('DELETE FROM t')).rejects.toThrow(/읽기 전용/);
    await db.close();
  });

  it('readonly 프로파일도 조회는 된다', async () => {
    const { db } = makeDb({ raw: rawProfile({ readonly: true }) });
    await expect(db.version()).resolves.toEqual({ version: '8' });
    await db.close();
  });
});

describe('db.ts — 프로파일 상한이 도구 요청을 이긴다', () => {
  beforeEach(() => {
    setExecuteImpl(vi.fn().mockResolvedValue([[{ a: 1 }, { a: 2 }, { a: 3 }], []]));
  });

  it('maxRows 를 프로파일 상한 이상으로 요청해도 상한에서 잘린다', async () => {
    const { db } = makeDb({ raw: rawProfile({ maxRows: 2 }) });
    const res = await db.queryRows('SELECT 1', [], { maxRows: 9999 });
    expect(res.rows).toHaveLength(2);
    expect(res.truncated).toBe(true);
    await db.close();
  });

  it('요청이 없으면 프로파일의 maxRows 를 쓴다', async () => {
    const { db } = makeDb({ raw: rawProfile({ maxRows: 1 }) });
    const res = await db.queryRows('SELECT 1');
    expect(res.rows).toHaveLength(1);
    expect(res.truncated).toBe(true);
    await db.close();
  });

  it('timeoutMs 를 프로파일 상한 이상으로 요청해도 상한이 적용된다', async () => {
    vi.useFakeTimers();
    setExecuteImpl(vi.fn().mockImplementation(() => new Promise(() => {})));
    const { db } = makeDb({ raw: rawProfile({ timeoutMs: 20 }) });
    const p = db.queryRows('SELECT SLEEP(5)', [], { timeoutMs: 999_999 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(p).rejects.toThrow('query timed out after 20ms');
    vi.useRealTimers();
  });
});
