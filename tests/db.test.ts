import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as mysqlModule from 'mysql2/promise';
import { createDatabase, Database } from '../src/db.js';
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
  MYSQL_HOST: 'h', MYSQL_PORT: 3306, MYSQL_USER: 'u', MYSQL_DATABASE: 'd', MYSQL_PROFILE: 'testprofile',
  MYSQL_SSL: 'off', MYSQL_CONNECT_TIMEOUT_MS: 10000, MYSQL_QUERY_TIMEOUT_MS: 60000, MYSQL_POOL_MIN: 0, MYSQL_POOL_MAX: 10,
  MAX_ROWS: 10000, LOG_LEVEL: 'silent',
};

function fakeResolver(password = 'pw-from-keychain'): SecretResolver & { resolve: ReturnType<typeof vi.fn> } {
  return { resolve: vi.fn().mockResolvedValue(password) } as any;
}

function setExecuteImpl(fn: any) {
  // @ts-ignore
  (mysqlModule.default.createPool as any)().execute = fn;
}

describe('db.ts', () => {
  let db: Database;
  beforeEach(() => {
    vi.useFakeTimers();
    db = createDatabase(baseCfg, fakeResolver());
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

  it('passes timezone and charset to mysql2 createPool', async () => {
    const cfg = { ...baseCfg, MYSQL_TIMEZONE: '+00:00', MYSQL_CHARSET: 'utf8mb4' } as any;
    const { createPool } = mysqlModule.default as any;
    (createPool as any).mockClear();
    const localDb = createDatabase(cfg, fakeResolver());
    setExecuteImpl(vi.fn().mockResolvedValue([[{ version: '8' }], []]));
    await localDb.version();
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({ timezone: '+00:00', charset: 'utf8mb4' }));
    await localDb.close();
  });
});

describe('db.ts — 비밀번호는 접속 시점에 Keychain 에서 꺼낸다', () => {
  const { createPool } = mysqlModule.default as any;

  beforeEach(() => {
    // setExecuteImpl 이 mock 풀을 꺼내느라 createPool 을 한 번 부르므로 그 뒤에 센다
    setExecuteImpl(vi.fn().mockResolvedValue([[{ version: '8' }], []]));
    (createPool as any).mockClear();
  });

  it('생성만으로는 풀도 만들지 않고 Keychain 도 보지 않는다', () => {
    const secrets = fakeResolver();
    createDatabase(baseCfg, secrets);
    expect(secrets.resolve).not.toHaveBeenCalled();
    expect(createPool).not.toHaveBeenCalled();
  });

  it('첫 조회에서 프로파일명으로 Keychain 을 조회해 풀에 비밀번호를 넘긴다', async () => {
    const secrets = fakeResolver('pw-from-keychain');
    const db = createDatabase(baseCfg, secrets);
    await db.version();

    const secret = secrets.resolve.mock.calls[0][0];
    expect(secret.service).toBe('mysql-mcp/testprofile');
    expect(secret.account).toBe('u');
    expect(createPool).toHaveBeenCalledWith(expect.objectContaining({ password: 'pw-from-keychain' }));
    await db.close();
  });

  it('두 번째 조회는 만들어 둔 풀을 재사용한다', async () => {
    const secrets = fakeResolver();
    const db = createDatabase(baseCfg, secrets);
    await db.version();
    await db.version();
    expect(secrets.resolve).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it('동시에 들어온 조회도 풀을 하나만 만든다', async () => {
    const secrets = fakeResolver();
    const db = createDatabase(baseCfg, secrets);
    await Promise.all([db.version(), db.version(), db.version()]);
    expect(secrets.resolve).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it('Keychain 조회 실패는 그대로 올라오고, 등록 뒤 재시도는 재시작 없이 통과한다', async () => {
    const secrets = { resolve: vi.fn() } as any;
    secrets.resolve.mockRejectedValueOnce(new Error('항목 없음')).mockResolvedValueOnce('pw');
    const db = createDatabase(baseCfg, secrets);

    await expect(db.version()).rejects.toThrow('항목 없음');
    expect(createPool).not.toHaveBeenCalled();

    await expect(db.version()).resolves.toEqual({ version: '8' });
    expect(createPool).toHaveBeenCalledTimes(1);
    await db.close();
  });

  it('한 번도 쓰지 않은 채 닫으면 아무 것도 하지 않는다', async () => {
    const secrets = fakeResolver();
    const db = createDatabase(baseCfg, secrets);
    await db.close();
    expect(secrets.resolve).not.toHaveBeenCalled();
    expect(createPool).not.toHaveBeenCalled();
  });
});
