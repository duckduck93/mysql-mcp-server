import mysql from 'mysql2/promise';
import type { Pool, FieldPacket, RowDataPacket, ResultSetHeader, PoolOptions } from 'mysql2/promise';
import type { AppConfig } from './config.js';
import { resolveHost } from './config.js';
import type { Profile } from './profile.js';
import type { ProfileRegistry } from './profile-registry.js';
import type { SecretResolver } from './secret-resolver.js';

export type QueryOptions = { timeoutMs?: number; maxRows?: number };
export type ExecOptions = { timeoutMs?: number };

export type DatabaseDeps = {
  registry: ProfileRegistry;
  profileName: string;
  cfg: AppConfig & { ssl?: any };
  secrets: SecretResolver;
};

/** 같은 접속 자격으로 만든 풀인지 가리는 열쇠. 프로파일 내용이 바뀌면 풀을 다시 만든다. */
function identityOf(profile: Profile): string {
  return `${profile.user}@${profile.host}:${profile.port}/${profile.database}`;
}

export class Database {
  private cached: { identity: string; pool: Promise<Pool> } | undefined;

  constructor(private readonly deps: DatabaseDeps) {}

  /**
   * 지금 이 순간의 프로파일을 읽어 게이트를 통과시킨 뒤 풀을 준다.
   *
   * 프로파일은 매 호출마다 다시 읽는다. 파일을 저장하는 순간 차단이 걸리게 하기 위해서다.
   */
  private async open(): Promise<{ pool: Pool; profile: Profile }> {
    const profile = this.deps.registry.get(this.deps.profileName);
    profile.assertOpenAt(new Date());
    return { pool: await this.poolFor(profile), profile };
  }

  private poolFor(profile: Profile): Promise<Pool> {
    const identity = identityOf(profile);
    if (this.cached && this.cached.identity !== identity) {
      // 접속 자격이 바뀌었다. 옛 풀은 뒤에서 정리하고 새로 만든다.
      const stale = this.cached.pool;
      this.cached = undefined;
      void stale.then(p => p.end()).catch(() => {});
    }
    if (!this.cached) {
      // 실패한 약속을 남겨두면 비밀번호를 등록해도 재시작 전까지 계속 실패한다.
      const pool = this.createPool(profile).catch(err => {
        this.cached = undefined;
        throw err;
      });
      this.cached = { identity, pool };
    }
    return this.cached.pool;
  }

  private async createPool(profile: Profile): Promise<Pool> {
    const { cfg, secrets } = this.deps;
    const password = await secrets.resolve(profile.secretLocation());
    const opts: PoolOptions = {
      host: resolveHost(profile.host),
      port: profile.port,
      user: profile.user,
      password,
      database: profile.database,
      ssl: cfg.ssl,
      waitForConnections: true,
      connectionLimit: cfg.MYSQL_POOL_MAX,
      queueLimit: 0,
      connectTimeout: cfg.MYSQL_CONNECT_TIMEOUT_MS,
    };
    if (cfg.MYSQL_TIMEZONE !== undefined) {
      (opts as any).timezone = cfg.MYSQL_TIMEZONE;
    }
    if (cfg.MYSQL_CHARSET !== undefined) {
      (opts as any).charset = cfg.MYSQL_CHARSET;
    }
    return mysql.createPool(opts);
  }

  /** 프로파일 상한을 넘지 못하게 조인다. 도구가 더 큰 값을 요청해도 프로파일이 이긴다. */
  private limitsFor(profile: Profile, opts: QueryOptions | ExecOptions) {
    const requestedTimeout = opts.timeoutMs ?? profile.timeoutMs ?? this.deps.cfg.MYSQL_QUERY_TIMEOUT_MS;
    const timeoutMs = profile.timeoutMs ? Math.min(requestedTimeout, profile.timeoutMs) : requestedTimeout;
    const requestedRows = (opts as QueryOptions).maxRows ?? profile.maxRows;
    return { timeoutMs, maxRows: Math.min(requestedRows, profile.maxRows) };
  }

  async close(): Promise<void> {
    const pending = this.cached?.pool;
    this.cached = undefined;
    if (!pending) return;
    await (await pending).end();
  }

  private withTimeout<T>(p: Promise<T>, timeoutMs?: number, label = 'operation'): Promise<T> {
    if (!timeoutMs) return p;
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  async queryRows(sql: string, params: any[] = [], opts: QueryOptions = {}) {
    const { pool, profile } = await this.open();
    const limits = this.limitsFor(profile, opts);
    const start = Date.now();
    const promise = pool.execute<RowDataPacket[]>(sql, params);
    const [rows, fields] = await this.withTimeout(promise, limits.timeoutMs, 'query');

    // fields may be undefined for some statements
    const columns = (fields ?? []).map((f: any) => ({ name: f.name as string, type: String(f.type ?? '') }));

    const truncated = Array.isArray(rows) && rows.length > limits.maxRows;
    const limitedRows = truncated ? (rows as any[]).slice(0, limits.maxRows) : rows;

    const elapsedMs = Date.now() - start;
    return { rows: limitedRows, columns, truncated, elapsedMs };
  }

  async execute(sql: string, params: any[] = [], opts: ExecOptions = {}) {
    const { pool, profile } = await this.open();
    profile.assertWritable();
    const limits = this.limitsFor(profile, opts);
    const start = Date.now();
    const promise = pool.execute<ResultSetHeader>(sql, params);
    const [result] = await this.withTimeout(promise, limits.timeoutMs, 'execute');
    const { affectedRows, insertId, warningStatus } = result as ResultSetHeader;
    const elapsedMs = Date.now() - start;
    return { affectedRows, insertId, warningStatus, elapsedMs };
  }

  async showTables(includeViews = false) {
    const sql = `SELECT TABLE_NAME as name, TABLE_TYPE as type \n                 FROM information_schema.tables \n                 WHERE TABLE_SCHEMA = DATABASE() ${includeViews ? '' : "AND TABLE_TYPE='BASE TABLE'"}\n                 ORDER BY TABLE_NAME`;
    const { rows } = await this.queryRows(sql);
    return rows as Array<{ name: string; type: 'BASE TABLE' | 'VIEW' }>;
  }

  async describeTable(table: string) {
    const columnSql = `SELECT COLUMN_NAME as name, COLUMN_TYPE as type, \n      IS_NULLABLE='YES' as nullable, COLUMN_DEFAULT as \`default\`, COLUMN_KEY as \`key\`, EXTRA as extra, COLUMN_COMMENT as comment\n      FROM information_schema.columns\n      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?\n      ORDER BY ORDINAL_POSITION`;
    const tableSql = `SELECT TABLE_COMMENT as comment FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`;
    const [columnsRes, tableRes] = await Promise.all([
      this.queryRows(columnSql, [table]),
      this.queryRows(tableSql, [table])
    ]);
    const tableComment = (tableRes.rows as any[])[0]?.comment as string | undefined;
    // Ensure nullable is a real boolean (MySQL may return 0/1)
    const columns = (columnsRes.rows as any[]).map((row: any) => ({
      ...row,
      nullable: !!row?.nullable,
    }));
    return { table, columns, tableComment };
  }

  async showIndexes(table: string) {
    // Use information_schema.statistics for structured data
    const sql = `SELECT INDEX_NAME as name, SEQ_IN_INDEX as seq, COLUMN_NAME as col, \n      NON_UNIQUE as nonUnique, INDEX_COMMENT as comment, INDEX_TYPE as \`type\`\n      FROM information_schema.statistics\n      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?\n      ORDER BY INDEX_NAME, SEQ_IN_INDEX`;
    let { rows } = await this.queryRows(sql, [table]);
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

  async explain(sql: string, params: any[] = []) {
    let { rows } = await this.queryRows(`EXPLAIN ${sql}`, params);
    if (Array.isArray(rows) && Array.isArray((rows as any[])[0])) {
      rows = (rows as any[])[0] as any[];
    }
    return rows as any[];
  }

  async version() {
    const { rows } = await this.queryRows('SELECT VERSION() AS version');
    const v = (rows as any[])[0]?.version ?? '';
    /* c8 ignore next */
    return { version: String(v) };
  }
}

export function createDatabase(deps: DatabaseDeps) {
  return new Database(deps);
}
