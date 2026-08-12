import mysql from 'mysql2/promise';
import type { Pool, PoolOptions } from 'mysql2/promise';
import type { AppConfig } from './config.js';
import { resolveHost } from './config.js';
import type { Profile } from './profile.js';
import type { SecretResolver } from './secret-resolver.js';

/** 같은 접속 자격으로 만든 풀인지 가리는 열쇠. 프로파일 내용이 바뀌면 풀을 다시 만든다. */
function identityOf(profile: Profile): string {
  return `${profile.user}@${profile.host}:${profile.port}/${profile.database}`;
}

/**
 * 프로파일별 커넥션 풀을 지연 생성해 들고 있는 일급 컬렉션.
 *
 * 물리적으로 다른 DB 라 풀도 따로 간다. 비밀번호는 풀을 만드는 순간에만 꺼내므로,
 * 쓰지 않는 프로파일의 비밀번호는 프로세스에 올라오지 않는다.
 */
export class ConnectionPools {
  private readonly pools = new Map<string, { identity: string; pool: Promise<Pool> }>();

  constructor(private readonly deps: { cfg: AppConfig & { ssl?: any }; secrets: SecretResolver }) {}

  acquire(profile: Profile): Promise<Pool> {
    const identity = identityOf(profile);
    const held = this.pools.get(profile.name);

    if (held && held.identity !== identity) {
      // 접속 자격이 바뀌었다. 옛 풀은 뒤에서 정리하고 새로 만든다.
      this.pools.delete(profile.name);
      void held.pool.then(p => p.end()).catch(() => {});
    } else if (held) {
      return held.pool;
    }

    // 실패한 약속을 남겨두면 비밀번호를 등록해도 재시작 전까지 계속 실패한다.
    const pool = this.create(profile).catch(err => {
      this.pools.delete(profile.name);
      throw err;
    });
    this.pools.set(profile.name, { identity, pool });
    return pool;
  }

  async closeAll(): Promise<void> {
    const held = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(held.map(h => h.pool.then(p => p.end()).catch(() => {})));
  }

  private async create(profile: Profile): Promise<Pool> {
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
}
