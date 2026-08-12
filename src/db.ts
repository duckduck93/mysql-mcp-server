import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { AppConfig } from './config.js';
import type { ConnectionPools } from './connection-pools.js';
import type { Profile } from './profile.js';
import type { ProfileRegistry } from './profile-registry.js';

export type QueryOptions = { timeoutMs?: number; maxRows?: number };
export type ExecOptions = { timeoutMs?: number };

export type DatabaseDeps = {
  registry: ProfileRegistry;
  pools: ConnectionPools;
  cfg: AppConfig & { ssl?: any };
};

/** `profiles` 도구가 돌려주는 한 줄. 접속정보는 싣지 않는다 — 고르는 데 필요한 것만 준다. */
export type ProfileStatus = {
  name: string;
  description: string;
  open: boolean;
  readonly: boolean;
  production: boolean;
  maxRows: number;
  expiresAt?: string;
};

/**
 * 프로파일은 열려 있는데 DB 에 붙지 못했을 때.
 *
 * 원인이 서버 밖(접근제어·네트워크·계정 상태)이라 Agent 가 스스로 풀 수 없다.
 * 다른 프로파일로 조용히 갈아타지 말고 사용자에게 확인을 요청하게 만든다.
 */
export class ProfileUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileUnreachableError';
  }
}

/** 접속 자체가 안 된 것으로 볼 오류. 쿼리 문법 오류 같은 것과 갈라야 한다. */
const CONNECTION_FAILURE_CODES = new Set([
  'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR',
  'ER_HOST_IS_BLOCKED', 'ER_CON_COUNT_ERROR', 'ER_NOT_SUPPORTED_AUTH_MODE',
  'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
]);

function isConnectionFailure(err: unknown): boolean {
  const e = err as { code?: string; fatal?: boolean } | null;
  if (!e) return false;
  return e.fatal === true || (typeof e.code === 'string' && CONNECTION_FAILURE_CODES.has(e.code));
}

export class Database {
  constructor(private readonly deps: DatabaseDeps) {}

  /** 프로파일 목록과 열림 상태. Agent 가 무엇을 고를지 판단하는 근거다. */
  listProfiles(now: Date = new Date()): ProfileStatus[] {
    return this.deps.registry.names().map(name => {
      const p = this.deps.registry.get(name);
      const status: ProfileStatus = {
        name: p.name,
        description: p.description,
        open: p.isOpenAt(now),
        readonly: !p.allowsWrite(),
        production: p.isProduction,
        maxRows: p.maxRows,
      };
      if (p.expiresAt) status.expiresAt = p.expiresAt.toISOString();
      return status;
    });
  }

  async close(): Promise<void> {
    await this.deps.pools.closeAll();
  }

  /**
   * 지금 이 순간의 프로파일을 읽어 게이트를 통과시킨 뒤 풀을 준다.
   *
   * 프로파일은 매 호출마다 다시 읽는다. 파일을 저장하는 순간 차단이 걸리게 하기 위해서다.
   */
  private async open(profileName: string): Promise<{ pool: Pool; profile: Profile }> {
    const profile = this.deps.registry.get(profileName);
    profile.assertOpenAt(new Date());
    return { pool: await this.deps.pools.acquire(profile), profile };
  }

  /** 접속 실패는 사용자에게 확인을 요청하라는 문구로 감싼다. 그 밖의 오류는 그대로 올린다. */
  private async runOn<T>(profile: Profile, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (!isConnectionFailure(err)) throw err;
      throw new ProfileUnreachableError(
        `프로파일 '${profile.name}' 은 열려 있지만 접속에 실패했다: ${(err as Error).message}\n` +
          `이 프로파일은 — ${profile.description}\n` +
          '임의로 다른 프로파일로 바꾸지 말고, 지금 접속 가능한 상태인지 사용자에게 확인을 요청한다.',
      );
    }
  }

  /** 프로파일 상한을 넘지 못하게 조인다. 도구가 더 큰 값을 요청해도 프로파일이 이긴다. */
  private limitsFor(profile: Profile, opts: QueryOptions) {
    const requestedTimeout = opts.timeoutMs ?? profile.timeoutMs ?? this.deps.cfg.MYSQL_QUERY_TIMEOUT_MS;
    const timeoutMs = profile.timeoutMs ? Math.min(requestedTimeout, profile.timeoutMs) : requestedTimeout;
    const requestedRows = opts.maxRows ?? profile.maxRows;
    return { timeoutMs, maxRows: Math.min(requestedRows, profile.maxRows) };
  }

  private withTimeout<T>(p: Promise<T>, timeoutMs?: number, label = 'operation'): Promise<T> {
    if (!timeoutMs) return p;
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  async queryRows({ profile: profileName, sql, params = [], maxRows, timeoutMs }: {
    profile: string; sql: string; params?: any[]; maxRows?: number; timeoutMs?: number;
  }) {
    const { pool, profile } = await this.open(profileName);
    const opts: QueryOptions = {};
    if (maxRows !== undefined) opts.maxRows = maxRows;
    if (timeoutMs !== undefined) opts.timeoutMs = timeoutMs;
    const limits = this.limitsFor(profile, opts);

    return this.runOn(profile, async () => {
      const start = Date.now();
      const [rows, fields] = await this.withTimeout(
        pool.execute<RowDataPacket[]>(sql, params), limits.timeoutMs, 'query');

      // fields may be undefined for some statements
      const columns = (fields ?? []).map((f: any) => ({ name: f.name as string, type: String(f.type ?? '') }));

      const truncated = Array.isArray(rows) && rows.length > limits.maxRows;
      const limitedRows = truncated ? (rows as any[]).slice(0, limits.maxRows) : rows;

      return { rows: limitedRows, columns, truncated, elapsedMs: Date.now() - start };
    });
  }

  async execute({ profile: profileName, sql, params = [], timeoutMs }: {
    profile: string; sql: string; params?: any[]; timeoutMs?: number;
  }) {
    const { pool, profile } = await this.open(profileName);
    profile.assertWritable();
    const opts: QueryOptions = {};
    if (timeoutMs !== undefined) opts.timeoutMs = timeoutMs;
    const limits = this.limitsFor(profile, opts);

    return this.runOn(profile, async () => {
      const start = Date.now();
      const [result] = await this.withTimeout(
        pool.execute<ResultSetHeader>(sql, params), limits.timeoutMs, 'execute');
      const { affectedRows, insertId, warningStatus } = result as ResultSetHeader;
      return { affectedRows, insertId, warningStatus, elapsedMs: Date.now() - start };
    });
  }

  async showTables({ profile, includeViews = false }: { profile: string; includeViews?: boolean }) {
    const sql = `SELECT TABLE_NAME as name, TABLE_TYPE as type \n                 FROM information_schema.tables \n                 WHERE TABLE_SCHEMA = DATABASE() ${includeViews ? '' : "AND TABLE_TYPE='BASE TABLE'"}\n                 ORDER BY TABLE_NAME`;
    const { rows } = await this.queryRows({ profile, sql });
    return rows as Array<{ name: string; type: 'BASE TABLE' | 'VIEW' }>;
  }

  async describeTable({ profile, table }: { profile: string; table: string }) {
    const columnSql = `SELECT COLUMN_NAME as name, COLUMN_TYPE as type, \n      IS_NULLABLE='YES' as nullable, COLUMN_DEFAULT as \`default\`, COLUMN_KEY as \`key\`, EXTRA as extra, COLUMN_COMMENT as comment\n      FROM information_schema.columns\n      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?\n      ORDER BY ORDINAL_POSITION`;
    const tableSql = `SELECT TABLE_COMMENT as comment FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`;
    const [columnsRes, tableRes] = await Promise.all([
      this.queryRows({ profile, sql: columnSql, params: [table] }),
      this.queryRows({ profile, sql: tableSql, params: [table] }),
    ]);
    const tableComment = (tableRes.rows as any[])[0]?.comment as string | undefined;
    // Ensure nullable is a real boolean (MySQL may return 0/1)
    const columns = (columnsRes.rows as any[]).map((row: any) => ({
      ...row,
      nullable: !!row?.nullable,
    }));
    return { table, columns, tableComment };
  }

  async showIndexes({ profile, table }: { profile: string; table: string }) {
    // Use information_schema.statistics for structured data
    const sql = `SELECT INDEX_NAME as name, SEQ_IN_INDEX as seq, COLUMN_NAME as col, \n      NON_UNIQUE as nonUnique, INDEX_COMMENT as comment, INDEX_TYPE as \`type\`\n      FROM information_schema.statistics\n      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?\n      ORDER BY INDEX_NAME, SEQ_IN_INDEX`;
    let { rows } = await this.queryRows({ profile, sql, params: [table] });
    // Some drivers/tests may return nested arrays like [plan] instead of plan
    if (Array.isArray(rows) && Array.isArray((rows as any[])[0])) {
      rows = (rows as any[])[0] as any[];
    }
    const map = new Map<string, { name: string; columns: string[]; unique: boolean; visible?: boolean; comment?: string; type?: string }>();
    for (const r of rows as any[]) {
      const key = r.name as string;
      const entry = map.get(key) ?? { name: key, columns: [] as string[], unique: !(r.nonUnique > 0), visible: (r.visible === 'YES'), comment: r.comment ?? undefined, type: r.type ?? undefined };
      /* c8 ignore next */
      entry.columns.push(String(r.col));
      map.set(key, entry);
    }
    return { table, indexes: Array.from(map.values()) };
  }

  async explain({ profile, sql, params = [] }: { profile: string; sql: string; params?: any[] }) {
    let { rows } = await this.queryRows({ profile, sql: `EXPLAIN ${sql}`, params });
    if (Array.isArray(rows) && Array.isArray((rows as any[])[0])) {
      rows = (rows as any[])[0] as any[];
    }
    return rows as any[];
  }

  async version({ profile }: { profile: string }) {
    const { rows } = await this.queryRows({ profile, sql: 'SELECT VERSION() AS version' });
    const v = (rows as any[])[0]?.version ?? '';
    /* c8 ignore next */
    return { version: String(v) };
  }
}

export function createDatabase(deps: DatabaseDeps) {
  return new Database(deps);
}
