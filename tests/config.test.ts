import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigSchema, loadConfig } from '../src/config.js';

function baseEnv() {
  return {
    MYSQL_HOST: 'localhost',
    MYSQL_USER: 'user',
    MYSQL_DATABASE: 'db',
  } as any;
}

describe('config.ts', () => {
  it('validates required fields', () => {
    const r = ConfigSchema.safeParse(baseEnv());
    expect(r.success).toBe(true);
  });

  it('fails when required fields missing', () => {
    const r = ConfigSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('applies defaults and coercions', () => {
    const env = { ...baseEnv(), MYSQL_PORT: '3307', MYSQL_POOL_MIN: '0', MYSQL_POOL_MAX: '5', MAX_ROWS: '100' };
    const parsed = ConfigSchema.parse(env);
    expect(parsed.MYSQL_PORT).toBe(3307);
    expect(parsed.MYSQL_POOL_MIN).toBe(0);
    expect(parsed.MYSQL_POOL_MAX).toBe(5);
    expect(parsed.MAX_ROWS).toBe(100);
    expect(parsed.MYSQL_SSL).toBe('off');
    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it('loadConfig sets ssl undefined when MYSQL_SSL=off', () => {
    const env = { ...baseEnv(), MYSQL_SSL: 'off' } as any;
    const cfg = loadConfig(env);
    expect(cfg.ssl).toBeUndefined();
  });

  it('loadConfig builds ssl object for required', () => {
    const env = { ...baseEnv(), MYSQL_SSL: 'required' } as any;
    const cfg = loadConfig(env);
    expect(cfg.ssl).toBeDefined();
    expect(cfg.ssl?.rejectUnauthorized).toBe(false);
  });

  it('loadConfig builds ssl object for verify_ca and decodes base64', () => {
    const ca = Buffer.from('CA').toString('base64');
    const cert = Buffer.from('CERT').toString('base64');
    const key = Buffer.from('KEY').toString('base64');
    const env = { ...baseEnv(), MYSQL_SSL: 'verify_ca', MYSQL_SSL_CA_BASE64: ca, MYSQL_SSL_CERT_BASE64: cert, MYSQL_SSL_KEY_BASE64: key } as any;
    const cfg = loadConfig(env);
    expect(cfg.ssl).toBeDefined();
    expect(cfg.ssl?.rejectUnauthorized).toBe(true);
    expect(cfg.ssl?.ca?.toString()).toBe('CA');
    expect(cfg.ssl?.cert?.toString()).toBe('CERT');
    expect(cfg.ssl?.key?.toString()).toBe('KEY');
  });

  it('remaps localhost to host.docker.internal when running in Docker (default auto)', async () => {
    const env = { ...baseEnv(), MYSQL_HOST: 'localhost', MYSQL_IN_DOCKER: '1' } as any;
    const cfg = loadConfig(env);
    expect(cfg.MYSQL_HOST).toBe('host.docker.internal');
  });

  it('does not remap when MYSQL_HOST_RESOLVE=off', async () => {
    const env = { ...baseEnv(), MYSQL_HOST: '127.0.0.1', MYSQL_HOST_RESOLVE: 'off', MYSQL_IN_DOCKER: '1' } as any;
    const cfg = loadConfig(env);
    expect(cfg.MYSQL_HOST).toBe('127.0.0.1');
  });

  it('does not remap when not running in Docker', async () => {
    const env = { ...baseEnv(), MYSQL_HOST: 'localhost', MYSQL_IN_DOCKER: '0' } as any;
    const cfg = loadConfig(env);
    expect(cfg.MYSQL_HOST).toBe('localhost');
  });

  it('uses MYSQL_HOST_DOCKER override when provided', async () => {
    const env = { ...baseEnv(), MYSQL_HOST: 'localhost', MYSQL_IN_DOCKER: '1', MYSQL_HOST_DOCKER: 'docker.host.test' } as any;
    const cfg = loadConfig(env);
    expect(cfg.MYSQL_HOST).toBe('docker.host.test');
  });
});
