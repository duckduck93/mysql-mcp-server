import { describe, it, expect } from 'vitest';
import { ConfigSchema, loadConfig, resolveHost } from '../src/config.js';

function baseEnv() {
  return {
    MYSQL_PROFILE: 'testprofile',
  } as any;
}

describe('config.ts', () => {
  it('validates required fields', () => {
    expect(ConfigSchema.safeParse(baseEnv()).success).toBe(true);
  });

  it('fails when required fields missing', () => {
    expect(ConfigSchema.safeParse({}).success).toBe(false);
  });

  it('MYSQL_PROFILE 이 없으면 기동하지 않는다', () => {
    const { MYSQL_PROFILE, ...withoutProfile } = baseEnv();
    expect(ConfigSchema.safeParse(withoutProfile).success).toBe(false);
  });

  it('접속정보와 비밀번호는 설정으로 싣지 않는다 — profiles.json 이 갖는다', () => {
    const cfg = loadConfig({
      ...baseEnv(), MYSQL_HOST: 'h', MYSQL_USER: 'u', MYSQL_DATABASE: 'd', MYSQL_PASSWORD: 'p',
    } as any);
    expect((cfg as any).MYSQL_HOST).toBeUndefined();
    expect((cfg as any).MYSQL_USER).toBeUndefined();
    expect((cfg as any).MYSQL_DATABASE).toBeUndefined();
    expect((cfg as any).MYSQL_PASSWORD).toBeUndefined();
  });

  it('비밀번호 출처는 기본이 keychain 이고 env 로 바꿀 수 있다', () => {
    expect(loadConfig(baseEnv()).MYSQL_SECRET_SOURCE).toBe('keychain');
    expect(loadConfig({ ...baseEnv(), MYSQL_SECRET_SOURCE: 'env' } as any).MYSQL_SECRET_SOURCE).toBe('env');
    expect(ConfigSchema.safeParse({ ...baseEnv(), MYSQL_SECRET_SOURCE: 'file' }).success).toBe(false);
  });

  it('프로파일 파일 경로를 환경변수로 지정할 수 있다', () => {
    expect(loadConfig({ ...baseEnv(), MYSQL_PROFILES: '/tmp/p.json' } as any).MYSQL_PROFILES).toBe('/tmp/p.json');
  });

  it('applies defaults and coercions', () => {
    const env = { ...baseEnv(), MYSQL_POOL_MIN: '0', MYSQL_POOL_MAX: '5', MYSQL_QUERY_TIMEOUT_MS: '100' };
    const parsed = ConfigSchema.parse(env);
    expect(parsed.MYSQL_POOL_MIN).toBe(0);
    expect(parsed.MYSQL_POOL_MAX).toBe(5);
    expect(parsed.MYSQL_QUERY_TIMEOUT_MS).toBe(100);
    expect(parsed.MYSQL_SSL).toBe('off');
    expect(parsed.LOG_LEVEL).toBe('info');
  });

  it('loadConfig sets ssl undefined when MYSQL_SSL=off', () => {
    expect(loadConfig({ ...baseEnv(), MYSQL_SSL: 'off' } as any).ssl).toBeUndefined();
  });

  it('loadConfig builds ssl object for required', () => {
    const cfg = loadConfig({ ...baseEnv(), MYSQL_SSL: 'required' } as any);
    expect(cfg.ssl).toBeDefined();
    expect(cfg.ssl?.rejectUnauthorized).toBe(false);
  });

  it('loadConfig builds ssl object for verify_ca and decodes base64', () => {
    const env = {
      ...baseEnv(), MYSQL_SSL: 'verify_ca',
      MYSQL_SSL_CA_BASE64: Buffer.from('CA').toString('base64'),
      MYSQL_SSL_CERT_BASE64: Buffer.from('CERT').toString('base64'),
      MYSQL_SSL_KEY_BASE64: Buffer.from('KEY').toString('base64'),
    } as any;
    const cfg = loadConfig(env);
    expect(cfg.ssl?.rejectUnauthorized).toBe(true);
    expect(cfg.ssl?.ca?.toString()).toBe('CA');
    expect(cfg.ssl?.cert?.toString()).toBe('CERT');
    expect(cfg.ssl?.key?.toString()).toBe('KEY');
  });
});

describe('resolveHost — 컨테이너 안의 localhost 를 호스트로 돌린다', () => {
  it('remaps localhost to host.docker.internal when running in Docker (default auto)', () => {
    expect(resolveHost('localhost', { MYSQL_IN_DOCKER: '1' } as any)).toBe('host.docker.internal');
  });

  it('does not remap when MYSQL_HOST_RESOLVE=off', () => {
    expect(resolveHost('127.0.0.1', { MYSQL_HOST_RESOLVE: 'off', MYSQL_IN_DOCKER: '1' } as any)).toBe('127.0.0.1');
  });

  it('does not remap when not running in Docker', () => {
    expect(resolveHost('localhost', { MYSQL_IN_DOCKER: '0' } as any)).toBe('localhost');
  });

  it('uses MYSQL_HOST_DOCKER override when provided', () => {
    expect(resolveHost('localhost', { MYSQL_IN_DOCKER: '1', MYSQL_HOST_DOCKER: 'docker.host.test' } as any))
      .toBe('docker.host.test');
  });

  it('루프백이 아닌 호스트는 건드리지 않는다', () => {
    expect(resolveHost('db.example.test', { MYSQL_IN_DOCKER: '1' } as any)).toBe('db.example.test');
  });
});
