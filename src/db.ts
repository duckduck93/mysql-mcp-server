import mysql from 'mysql2/promise';
import type { Pool, FieldPacket, RowDataPacket, ResultSetHeader, PoolOptions } from 'mysql2/promise';
import type { AppConfig } from './config.js';

export type QueryOptions = { timeoutMs?: number; maxRows?: number };
export type ExecOptions = { timeoutMs?: number };

export class Database {
  private pool: Pool;
  constructor(private cfg: AppConfig & { ssl?: any }) {
    const conf = this.cfg;
    const opts: PoolOptions = {
      host: conf.MYSQL_HOST,
      port: conf.MYSQL_PORT,
      user: conf.MYSQL_USER,
      password: conf.MYSQL_PASSWORD,
      database: conf.MYSQL_DATABASE,
      ssl: conf.ssl,
      waitForConnections: true,
      connectionLimit: conf.MYSQL_POOL_MAX,
      queueLimit: 0,
      connectTimeout: conf.MYSQL_CONNECT_TIMEOUT_MS,
    };
    if (conf.MYSQL_TIMEZONE !== undefined) {
      (opts as any).timezone = conf.MYSQL_TIMEZONE;
    }
    if (conf.MYSQL_CHARSET !== undefined) {
      (opts as any).charset = conf.MYSQL_CHARSET;
    }
    this.pool = mysql.createPool(opts);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private withTimeout<T>(p: Promise<T>, timeoutMs?: number, label = 'operation'): Promise<T> {
    if (!timeoutMs) return p;
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  async queryRows(sql: string, params: any[] = [], opts: QueryOptions = {}) {
    const start = Date.now();
    const promise = this.pool.execute<RowDataPacket[]>(sql, params);
    const [rows, fields] = await this.withTimeout(promise, opts.timeoutMs ?? undefined, 'query');

    // fields may be undefined for some statements
    const columns = (fields ?? []).map((f: any) => ({ name: f.name as string, type: String(f.type ?? '') }));

    const maxRows = opts.maxRows ?? Infinity;
    const truncated = Array.isArray(rows) && rows.length > maxRows;
    const limitedRows = truncated ? (rows as any[]).slice(0, maxRows) : rows;

    const elapsedMs = Date.now() - start;
    return { rows: limitedRows, columns, truncated, elapsedMs };
  }

  async execute(sql: string, params: any[] = [], opts: ExecOptions = {}) {
    const start = Date.now();
    const promise = this.pool.execute<ResultSetHeader>(sql, params);
    const [result] = await this.withTimeout(promise, opts.timeoutMs ?? undefined, 'execute');
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
    return { table, columns: columnsRes.rows, tableComment };
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

export function createDatabase(cfg: AppConfig & { ssl?: any }) {
  return new Database(cfg);
}
