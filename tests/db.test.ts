import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDatabase, Database, ProfileUnreachableError } from '../src/db.js';
import { Profile } from '../src/profile.js';
import type { AppConfig } from '../src/config.js';

const cfg = { MYSQL_QUERY_TIMEOUT_MS: 60000 } as unknown as AppConfig & { ssl?: any };

const rawProfile = (overrides: Record<string, unknown> = {}) => ({
  host: 'h', port: 3306, database: 'd', user: 'u',
  enabled: true, readonly: false, maxRows: 100,
  description: '언제 이걸 쓰는지',
  ...overrides,
});

/** 내용을 갈아끼울 수 있는 가짜 레지스트리. get 호출 횟수를 센다. */
function fakeRegistry(profiles: Record<string, Record<string, unknown>> = { dev: rawProfile() }) {
  const state = { profiles, gets: 0 };
  const registry = {
    get(name: string) {
      state.gets++;
      const raw = state.profiles[name];
      if (!raw) throw new Error(`알 수 없는 프로파일 '${name}'`);
      return Profile.from({ name, raw });
    },
    names: () => Object.keys(state.profiles),
    choices: () => [],
  } as any;
  return {
    registry,
    get gets() { return state.gets; },
    replaceWith(next: Record<string, Record<string, unknown>>) { state.profiles = next; },
  };
}

function makeDb(opts: { profiles?: Record<string, Record<string, unknown>>; execute?: any } = {}) {
  const reg = fakeRegistry(opts.profiles ?? { dev: rawProfile() });
  const pool = { execute: opts.execute ?? vi.fn().mockResolvedValue([[{ version: '8' }], []]), end: vi.fn() };
  const pools = {
    acquire: vi.fn().mockResolvedValue(pool),
    closeAll: vi.fn().mockResolvedValue(undefined),
  };
  const db = createDatabase({ registry: reg.registry, pools: pools as any, cfg });
  return { db, reg, pools, pool };
}

function setExecute(pool: any, fn: any) {
  pool.execute = fn;
}

describe('db.ts — 도구는 프로파일을 지정해 부른다', () => {
  let db: Database;
  let pool: any;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ db, pool } = makeDb());
  });
  afterEach(() => vi.useRealTimers());

  it('queryRows returns rows, columns, truncated and measures elapsed', async () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    setExecute(pool, vi.fn().mockResolvedValue([rows, [{ name: 'a', type: 3 }]]));
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1005);
    const res = await db.queryRows({ profile: 'dev', sql: 'SELECT 1', maxRows: 2 });
    expect(res.columns).toEqual([{ name: 'a', type: '3' }]);
    expect(res.rows).toEqual(rows.slice(0, 2));
    expect(res.truncated).toBe(true);
    expect(res.elapsedMs).toBe(5);
  });

  it('queryRows handles undefined fields and no truncation', async () => {
    setExecute(pool, vi.fn().mockResolvedValue([[{ a: 1 }], undefined]));
    const res = await db.queryRows({ profile: 'dev', sql: 'SELECT 1' });
    expect(res.columns).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it('queryRows timeout rejects with proper message', async () => {
    setExecute(pool, vi.fn().mockImplementation(() => new Promise(() => {})));
    const p = db.queryRows({ profile: 'dev', sql: 'SELECT SLEEP(5)', timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    await expect(p).rejects.toThrow('query timed out after 50ms');
  });

  it('execute returns affectedRows, insertId, warningStatus and elapsedMs', async () => {
    setExecute(pool, vi.fn().mockResolvedValue([{ affectedRows: 2, insertId: 7, warningStatus: 0 }]));
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(3);
    const res = await db.execute({ profile: 'dev', sql: 'UPDATE x SET a=1' });
    expect(res).toEqual({ affectedRows: 2, insertId: 7, warningStatus: 0, elapsedMs: 3 });
  });

  it('execute timeout rejects', async () => {
    setExecute(pool, vi.fn().mockImplementation(() => new Promise(() => {})));
    const p = db.execute({ profile: 'dev', sql: 'UPDATE slow', timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(11);
    await expect(p).rejects.toThrow('execute timed out after 10ms');
  });

  it('showTables delegates to queryRows and returns typed list', async () => {
    setExecute(pool, vi.fn().mockResolvedValue([[
      { name: 'A', type: 'BASE TABLE' }, { name: 'V', type: 'VIEW' },
    ], [{ name: 'name' }]]));
    const list = await db.showTables({ profile: 'dev', includeViews: true });
    expect(list).toEqual([{ name: 'A', type: 'BASE TABLE' }, { name: 'V', type: 'VIEW' }]);
  });

  it('describeTable merges columns and table comment', async () => {
    let call = 0;
    setExecute(pool, vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([[{ name: 'id', type: 'int', nullable: false }], []]);
      return Promise.resolve([[{ comment: 't-comment' }], []]);
    }));
    const res = await db.describeTable({ profile: 'dev', table: 't' });
    expect(res.table).toBe('t');
    expect(res.tableComment).toBe('t-comment');
  });

  it('describeTable converts numeric nullable to boolean', async () => {
    let call = 0;
    setExecute(pool, vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([[{ name: 'n', type: 'varchar', nullable: 1 }], []]);
      return Promise.resolve([[{ comment: '' }], []]);
    }));
    const res = await db.describeTable({ profile: 'dev', table: 't2' });
    expect(res.columns[0].nullable).toBe(true);
  });

  it('showIndexes groups by index name and maps fields', async () => {
    const stats = [
      { name: 'PRIMARY', seq: 1, col: 'id', nonUnique: 0, comment: null, type: 'BTREE', visible: 'YES' },
      { name: 'idx_a', seq: 1, col: 'a', nonUnique: 1, comment: 'c', type: 'BTREE', visible: 'NO' },
      { name: 'idx_a', seq: 2, col: 'b', nonUnique: 1, comment: 'c', type: 'BTREE', visible: 'NO' },
    ];
    setExecute(pool, vi.fn().mockResolvedValue([[stats], [{ name: 'INDEX_NAME' }]]));
    const res = await db.showIndexes({ profile: 'dev', table: 't' });
    const primary = res.indexes.find(i => i.name === 'PRIMARY')!;
    expect(primary.columns).toEqual(['id']);
    expect(primary.unique).toBe(true);
    const idxA = res.indexes.find(i => i.name === 'idx_a')!;
    expect(idxA.columns).toEqual(['a', 'b']);
    expect(idxA.unique).toBe(false);
    expect(idxA.visible).toBe(false);
  });

  it('showIndexes handles non-nested rows path', async () => {
    setExecute(pool, vi.fn().mockResolvedValue([[
      { name: 'ix', seq: 1, col: 'c1', nonUnique: 1, comment: '', type: 'BTREE', visible: 'YES' },
    ], []]));
    const res = await db.showIndexes({ profile: 'dev', table: 't3' });
    expect(res.indexes[0].columns).toEqual(['c1']);
  });

  it('explain returns plan rows', async () => {
    setExecute(pool, vi.fn().mockResolvedValue([[[{ id: 1 }]], []]));
    expect(await db.explain({ profile: 'dev', sql: 'SELECT 1' })).toEqual([{ id: 1 }]);
  });

  it('explain handles non-nested rows path', async () => {
    setExecute(pool, vi.fn().mockResolvedValue([[{ id: 2 }], []]));
    expect(await db.explain({ profile: 'dev', sql: 'SELECT 2' })).toEqual([{ id: 2 }]);
  });

  it('version selects version field', async () => {
    setExecute(pool, vi.fn().mockResolvedValue([[{ version: '8.0.x' }], []]));
    expect(await db.version({ profile: 'dev' })).toEqual({ version: '8.0.x' });
  });
});

describe('db.ts — 게이트는 호출 시점에 걸린다', () => {
  it('호출할 때마다 프로파일을 다시 읽는다', async () => {
    const { db, reg } = makeDb();
    await db.version({ profile: 'dev' });
    await db.version({ profile: 'dev' });
    expect(reg.gets).toBe(2);
  });

  it('닫힌 프로파일은 조회를 거부하고 사용자에게 물으라고 한다', async () => {
    const { db } = makeDb({ profiles: { dev: rawProfile({ enabled: false }) } });
    await expect(db.version({ profile: 'dev' })).rejects.toThrow(/사용자/);
  });

  it('열려 있다가 닫히면 다음 호출부터 거부된다 — 재시작이 필요 없다', async () => {
    const { db, reg } = makeDb();
    await expect(db.version({ profile: 'dev' })).resolves.toEqual({ version: '8' });
    reg.replaceWith({ dev: rawProfile({ enabled: false }) });
    await expect(db.version({ profile: 'dev' })).rejects.toThrow(/닫혀/);
  });

  it('닫힌 프로파일에는 풀도 만들지 않는다', async () => {
    const { db, pools } = makeDb({ profiles: { dev: rawProfile({ enabled: false }) } });
    await db.version({ profile: 'dev' }).catch(() => {});
    expect(pools.acquire).not.toHaveBeenCalled();
  });

  it('readonly 프로파일은 쓰기를 거부하고 조회는 통과시킨다', async () => {
    const { db } = makeDb({ profiles: { dev: rawProfile({ readonly: true }) } });
    await expect(db.execute({ profile: 'dev', sql: 'DELETE FROM t' })).rejects.toThrow(/읽기 전용/);
    await expect(db.version({ profile: 'dev' })).resolves.toEqual({ version: '8' });
  });

  it('여러 프로파일이 동시에 열려 있을 수 있고 각자 쓰인다', async () => {
    const { db, pools } = makeDb({
      profiles: { dev: rawProfile(), prod: rawProfile({ user: 'p', readonly: true }) },
    });
    await db.version({ profile: 'dev' });
    await db.version({ profile: 'prod' });
    expect(pools.acquire.mock.calls.map(c => c[0].name)).toEqual(['dev', 'prod']);
  });
});

describe('db.ts — 프로파일 상한이 도구 요청을 이긴다', () => {
  it('maxRows 를 상한 이상으로 요청해도 상한에서 잘린다', async () => {
    const { db } = makeDb({
      profiles: { dev: rawProfile({ maxRows: 2 }) },
      execute: vi.fn().mockResolvedValue([[{ a: 1 }, { a: 2 }, { a: 3 }], []]),
    });
    const res = await db.queryRows({ profile: 'dev', sql: 'SELECT 1', maxRows: 9999 });
    expect(res.rows).toHaveLength(2);
    expect(res.truncated).toBe(true);
  });

  it('요청이 없으면 프로파일의 maxRows 를 쓴다', async () => {
    const { db } = makeDb({
      profiles: { dev: rawProfile({ maxRows: 1 }) },
      execute: vi.fn().mockResolvedValue([[{ a: 1 }, { a: 2 }], []]),
    });
    const res = await db.queryRows({ profile: 'dev', sql: 'SELECT 1' });
    expect(res.rows).toHaveLength(1);
  });

  it('timeoutMs 를 상한 이상으로 요청해도 상한이 적용된다', async () => {
    vi.useFakeTimers();
    const { db } = makeDb({
      profiles: { dev: rawProfile({ timeoutMs: 20 }) },
      execute: vi.fn().mockImplementation(() => new Promise(() => {})),
    });
    const p = db.queryRows({ profile: 'dev', sql: 'SELECT SLEEP(5)', timeoutMs: 999_999 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(p).rejects.toThrow('query timed out after 20ms');
    vi.useRealTimers();
  });
});

describe('db.ts — 열려 있는데 못 붙으면 사용자에게 확인을 요청한다', () => {
  function failWith(code: string, message = 'boom', fatal = false) {
    const err: any = new Error(message);
    err.code = code;
    err.fatal = fatal;
    return vi.fn().mockRejectedValue(err);
  }

  it('인증 거부는 프로파일 설명과 함께 감싼다', async () => {
    const { db } = makeDb({ execute: failWith('ER_ACCESS_DENIED_ERROR', "Access denied for user 'u'") });
    const err = await db.version({ profile: 'dev' }).catch(e => e);
    expect(err).toBeInstanceOf(ProfileUnreachableError);
    expect(err.message).toContain('dev');
    expect(err.message).toContain("Access denied for user 'u'");
    expect(err.message).toContain('언제 이걸 쓰는지');
    expect(err.message).toMatch(/사용자에게 확인/);
    expect(err.message).toMatch(/다른 프로파일로 바꾸지 말고/);
  });

  it('네트워크 오류도 같은 방식으로 감싼다', async () => {
    const { db } = makeDb({ execute: failWith('ECONNREFUSED') });
    await expect(db.version({ profile: 'dev' })).rejects.toBeInstanceOf(ProfileUnreachableError);
  });

  it('fatal 로 표시된 오류도 접속 실패로 본다', async () => {
    const { db } = makeDb({ execute: failWith('SOME_UNKNOWN', 'handshake failed', true) });
    await expect(db.version({ profile: 'dev' })).rejects.toBeInstanceOf(ProfileUnreachableError);
  });

  it('SQL 문법 오류는 감싸지 않고 그대로 올린다', async () => {
    const { db } = makeDb({ execute: failWith('ER_PARSE_ERROR', 'You have an error in your SQL syntax') });
    const err = await db.queryRows({ profile: 'dev', sql: 'SELEC 1' }).catch(e => e);
    expect(err).not.toBeInstanceOf(ProfileUnreachableError);
    expect(err.message).toContain('SQL syntax');
  });

  it('비밀번호 조회 실패는 그대로 올린다 — 이미 무엇을 할지 알려주는 문구다', async () => {
    const { db, pools } = makeDb();
    pools.acquire.mockRejectedValueOnce(new Error('Keychain 에 mysql-mcp/dev 항목이 없다'));
    await expect(db.version({ profile: 'dev' })).rejects.toThrow(/Keychain/);
  });
});

describe('db.ts — 프로파일 목록', () => {
  const NOW = new Date('2026-08-12T10:00:00Z');

  it('이름·설명·열림 여부·읽기전용·상한을 준다', () => {
    const { db } = makeDb({
      profiles: {
        dev: rawProfile(),
        prod: rawProfile({ enabled: undefined, enabledUntil: '2026-08-12T11:00:00Z', readonly: true, maxRows: 500 }),
      },
    });
    expect(db.listProfiles(NOW)).toEqual([
      { name: 'dev', description: '언제 이걸 쓰는지', open: true, readonly: false, maxRows: 100 },
      {
        name: 'prod', description: '언제 이걸 쓰는지', open: true, readonly: true, maxRows: 500,
        expiresAt: '2026-08-12T11:00:00.000Z',
      },
    ]);
  });

  it('닫힌 프로파일도 목록에 남아 무엇이 있는지 보인다', () => {
    const { db } = makeDb({ profiles: { dev: rawProfile({ enabled: false }) } });
    expect(db.listProfiles(NOW)).toEqual([
      { name: 'dev', description: '언제 이걸 쓰는지', open: false, readonly: false, maxRows: 100 },
    ]);
  });

  it('만료된 프로파일은 닫힌 것으로 보이고 만료 시각을 남긴다', () => {
    const { db } = makeDb({
      profiles: { prod: rawProfile({ enabled: undefined, enabledUntil: '2026-08-12T09:00:00Z' }) },
    });
    const [row] = db.listProfiles(NOW);
    expect(row.open).toBe(false);
    expect(row.expiresAt).toBe('2026-08-12T09:00:00.000Z');
  });

  it('접속정보는 싣지 않는다', () => {
    const { db } = makeDb();
    expect(JSON.stringify(db.listProfiles(NOW))).not.toMatch(/host|port|user|password/);
  });
});

describe('db.ts — 닫기', () => {
  it('풀을 모두 닫는다', async () => {
    const { db, pools } = makeDb();
    await db.close();
    expect(pools.closeAll).toHaveBeenCalled();
  });
});
