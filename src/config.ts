import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

export const ConfigSchema = z.object({
  // 접속정보(host·port·user·database)는 여기 없다. profiles.json 이 갖는다.
  // 어느 프로파일을 쓸지도 여기 없다. 도구 호출마다 Agent 가 인자로 고른다.
  // 비밀번호도 없다. 선언한 출처에서 접속 시점에 꺼낸다.
  MYSQL_SECRET_SOURCE: z.enum(['keychain', 'env']).default('keychain'),
  MYSQL_PROFILES: z.string().optional(),

  MYSQL_SSL: z.enum(['off', 'required', 'verify_ca']).default('off'),
  MYSQL_SSL_CA_BASE64: z.string().optional(),
  MYSQL_SSL_CERT_BASE64: z.string().optional(),
  MYSQL_SSL_KEY_BASE64: z.string().optional(),

  MYSQL_TIMEZONE: z.string().optional(),
  MYSQL_CHARSET: z.string().optional(),

  MYSQL_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  MYSQL_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  MYSQL_POOL_MIN: z.coerce.number().int().min(0).default(0),
  MYSQL_POOL_MAX: z.coerce.number().int().min(1).default(10),

  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

function fromBase64(b64?: string): Buffer | undefined {
  if (!b64) return undefined;
  return Buffer.from(b64, 'base64');
}

function runningInDocker(env: Record<string, string | undefined>): boolean {
  // Prefer explicit env flag first for testability and control
  const flag = String(env.MYSQL_IN_DOCKER ?? '').toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  try {
    // 1) Docker specific file
    if (fs.existsSync('/.dockerenv')) return true;
  } catch {}
  try {
    // 2) Check cgroup/hints (lightweight: existence often indicates containerized env)
    if (fs.existsSync('/proc/1/cgroup')) return true;
  } catch {}
  // 3) Fallback: some orchestrators mount container-specific dirs
  try {
    if (fs.existsSync(path.join('/', 'run', 'dockershim.sock'))) return true;
  } catch {}
  return false;
}

/**
 * 컨테이너 안에서 "localhost" 가 호스트 머신을 가리키도록 바꿔 준다.
 *
 * 프로파일의 host 에 적용한다. 동작은 환경변수로 끌 수 있다.
 * - MYSQL_HOST_RESOLVE: 'auto'(기본) | 'off'
 * - MYSQL_HOST_DOCKER: 바꿔 넣을 호스트 (기본 host.docker.internal)
 */
export function resolveHost(host: string, env: Record<string, string | undefined> = process.env): string {
  const mode = (env.MYSQL_HOST_RESOLVE ?? 'auto').toString();
  const isLoopback = host === 'localhost' || host === '127.0.0.1';
  if (mode === 'off' || !isLoopback || !runningInDocker(env)) return host;
  return env.MYSQL_HOST_DOCKER || 'host.docker.internal';
}

export function loadConfig(env = process.env): AppConfig & {
  ssl?: {
    ca?: Buffer;
    cert?: Buffer;
    key?: Buffer;
    rejectUnauthorized?: boolean;
  };
} {
  const parsed = ConfigSchema.parse(env);

  const sslMode = parsed.MYSQL_SSL;
  let ssl: undefined | { ca?: Buffer; cert?: Buffer; key?: Buffer; rejectUnauthorized?: boolean } = undefined;
  if (sslMode !== 'off') {
    const ca = fromBase64(parsed.MYSQL_SSL_CA_BASE64);
    const cert = fromBase64(parsed.MYSQL_SSL_CERT_BASE64);
    const key = fromBase64(parsed.MYSQL_SSL_KEY_BASE64);
    // Construct without assigning undefined to satisfy exactOptionalPropertyTypes
    const obj: { ca?: Buffer; cert?: Buffer; key?: Buffer; rejectUnauthorized?: boolean } = {
      rejectUnauthorized: sslMode === 'verify_ca',
    };
    if (ca) obj.ca = ca;
    if (cert) obj.cert = cert;
    if (key) obj.key = key;
    ssl = obj;
  }

  return { ...parsed, ssl } as any;
}
