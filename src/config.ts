import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

export const ConfigSchema = z.object({
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().min(1),

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

  MAX_ROWS: z.coerce.number().int().min(1).default(10_000),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

function fromBase64(b64?: string): Buffer | undefined {
  if (!b64) return undefined;
  return Buffer.from(b64, 'base64');
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

  // Resolve MYSQL_HOST when running inside Docker to make "localhost" work.
  // In Docker containers, "localhost" refers to the container itself, not the host
  // where the MySQL server may actually be running. On Mac/Windows Docker,
  // "host.docker.internal" points back to the host machine.
  // Behavior can be controlled via optional envs:
  // - MYSQL_HOST_RESOLVE: 'auto' (default) | 'off'
  // - MYSQL_HOST_DOCKER: override target host when remapping (default: host.docker.internal)
  const resolveMode = (env.MYSQL_HOST_RESOLVE ?? 'auto').toString();
  let MYSQL_HOST = parsed.MYSQL_HOST;

  function runningInDocker(): boolean {
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
      const procCgroup = '/proc/1/cgroup';
      if (fs.existsSync(procCgroup)) return true;
    } catch {}
    // 3) Fallback: some orchestrators mount container-specific dirs
    try {
      if (fs.existsSync(path.join('/', 'run', 'dockershim.sock'))) return true;
    } catch {}
    return false;
  }

  if (
    resolveMode !== 'off' &&
    (MYSQL_HOST === 'localhost' || MYSQL_HOST === '127.0.0.1') &&
    runningInDocker()
  ) {
    MYSQL_HOST = env.MYSQL_HOST_DOCKER || 'host.docker.internal';
  }

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

  return { ...parsed, MYSQL_HOST, ssl } as any;
}
