import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import {
  EnvSecretResolver,
  KeychainSecret,
  KeychainSecretError,
  KeychainSecretResolver,
  createSecretResolver,
  type SecurityRunResult,
} from '../src/secret-resolver.js';

/** 주어진 결과만 돌려주면서 호출 인자를 기록하는 러너. */
function stubRunner(result: Partial<SecurityRunResult>) {
  const calls: string[][] = [];
  const run = async (args: readonly string[]): Promise<SecurityRunResult> => {
    calls.push([...args]);
    return { code: 0, stdout: '', killed: false, ...result };
  };
  return { run, calls };
}

const devSecret = () => KeychainSecret.forProfile({ profile: 'dev', account: 'someuser' });

describe('KeychainSecret', () => {
  it('서비스명을 mysql-mcp/<프로파일> 관례로 만든다', () => {
    const secret = KeychainSecret.forProfile({ profile: 'prod', account: 'someuser' });
    expect(secret.service).toBe('mysql-mcp/prod');
    expect(secret.account).toBe('someuser');
  });

  it('프로파일명이나 계정이 비면 즉시 실패한다', () => {
    expect(() => KeychainSecret.forProfile({ profile: '', account: 'u' })).toThrow(/프로파일/);
    expect(() => KeychainSecret.forProfile({ profile: 'dev', account: '  ' })).toThrow(/계정/);
  });

  it('등록 안내 명령에 서비스명과 계정이 들어간다', () => {
    const cmd = devSecret().registerCommand();
    expect(cmd).toContain('add-generic-password');
    expect(cmd).toContain('mysql-mcp/dev');
    expect(cmd).toContain('someuser');
  });
});

describe('KeychainSecretResolver', () => {
  it('security find-generic-password 를 서비스·계정과 함께 호출한다', async () => {
    const { run, calls } = stubRunner({ stdout: 'p\n' });
    await KeychainSecretResolver.withRunner(run).resolve(devSecret());
    expect(calls).toEqual([
      ['find-generic-password', '-s', 'mysql-mcp/dev', '-a', 'someuser', '-w'],
    ]);
  });

  it('끝의 개행만 떼고 값을 그대로 돌려준다', async () => {
    const { run } = stubRunner({ stdout: ' pa ss\n' });
    await expect(KeychainSecretResolver.withRunner(run).resolve(devSecret())).resolves.toBe(' pa ss');
  });

  it('항목이 없으면(exit 44) 등록 방법과 함께 실패한다', async () => {
    const { run } = stubRunner({ code: 44 });
    const err = await KeychainSecretResolver.withRunner(run).resolve(devSecret()).catch(e => e);
    expect(err).toBeInstanceOf(KeychainSecretError);
    expect(err.reason).toBe('not-found');
    expect(err.message).toContain('mysql-mcp/dev');
    expect(err.message).toContain('add-generic-password');
  });

  it('사용자가 승인을 거부하면(exit 128) 거부로 구분해 실패한다', async () => {
    const { run } = stubRunner({ code: 128 });
    const err = await KeychainSecretResolver.withRunner(run).resolve(devSecret()).catch(e => e);
    expect(err.reason).toBe('denied');
    expect(err.message).toContain('mysql-mcp/dev');
  });

  it('승인 창이 방치돼 시간이 초과되면 timeout 으로 구분해 실패한다', async () => {
    const { run } = stubRunner({ code: null, killed: true });
    const err = await KeychainSecretResolver.withRunner(run).resolve(devSecret()).catch(e => e);
    expect(err.reason).toBe('timeout');
  });

  it('그 밖의 실패는 종료코드를 붙여 실패한다', async () => {
    const { run } = stubRunner({ code: 1 });
    const err = await KeychainSecretResolver.withRunner(run).resolve(devSecret()).catch(e => e);
    expect(err.reason).toBe('failed');
    expect(err.message).toContain('1');
  });

  it('성공했는데 값이 비어 있으면 실패로 본다', async () => {
    const { run } = stubRunner({ code: 0, stdout: '\n' });
    const err = await KeychainSecretResolver.withRunner(run).resolve(devSecret()).catch(e => e);
    expect(err.reason).toBe('empty');
  });

  it('에러 메시지에 비밀번호 값이 절대 실리지 않는다', async () => {
    const leaked = 'super-secret-value';
    for (const result of [{ code: 44, stdout: leaked }, { code: 1, stdout: leaked }, { code: 0, stdout: '\n' }]) {
      const { run } = stubRunner(result);
      const err = await KeychainSecretResolver.withRunner(run).resolve(devSecret()).catch(e => e);
      expect(`${err.message}\n${err.stack}`).not.toContain(leaked);
    }
  });

  it('환경변수 폴백을 타지 않는다 — 조회에 실패하면 그대로 실패한다', async () => {
    const { run } = stubRunner({ code: 44 });
    process.env.MYSQL_PASSWORD = 'from-env';
    try {
      await expect(KeychainSecretResolver.withRunner(run).resolve(devSecret())).rejects.toThrow();
    } finally {
      delete process.env.MYSQL_PASSWORD;
    }
  });
});

describe('EnvSecretResolver', () => {
  it('MYSQL_PASSWORD 를 그대로 돌려준다', async () => {
    const resolver = EnvSecretResolver.fromEnv({ MYSQL_PASSWORD: 'pw' });
    await expect(resolver.resolve(devSecret())).resolves.toBe('pw');
  });

  it('MYSQL_PASSWORD 가 없거나 비면 즉시 실패한다', async () => {
    await expect(EnvSecretResolver.fromEnv({}).resolve(devSecret())).rejects.toThrow(/MYSQL_PASSWORD/);
    await expect(EnvSecretResolver.fromEnv({ MYSQL_PASSWORD: '' }).resolve(devSecret())).rejects.toThrow(/MYSQL_PASSWORD/);
  });
});

describe('createSecretResolver — 출처는 명시 선언으로만 고른다', () => {
  it('기본은 keychain 이다', () => {
    const resolver = createSecretResolver({ env: {}, platform: 'darwin' });
    expect(resolver).toBeInstanceOf(KeychainSecretResolver);
  });

  it('source=env 를 고르면 환경변수 조회기를 쓴다', () => {
    const resolver = createSecretResolver({ source: 'env', env: { MYSQL_PASSWORD: 'pw' }, platform: 'win32' });
    expect(resolver).toBeInstanceOf(EnvSecretResolver);
  });

  it('macOS 가 아닌 곳에서 keychain 을 고르면 기동 시점에 실패한다', () => {
    expect(() => createSecretResolver({ source: 'keychain', env: {}, platform: 'win32' }))
      .toThrow(/MYSQL_SECRET_SOURCE=env/);
  });

  it('Keychain 조회가 실패해도 환경변수로 새지 않는다', async () => {
    const { run } = stubRunner({ code: 44 });
    const resolver = KeychainSecretResolver.withRunner(run);
    const err = await resolver.resolve(devSecret()).catch(e => e);
    expect(err.reason).toBe('not-found');
    expect(resolver).not.toBeInstanceOf(EnvSecretResolver);
  });
});

// 실제 security(1) 를 태우는 구간. 더미 값으로 항목을 만들고 끝나면 지운다.
// security 로 만든 항목은 security 가 신뢰 목록에 자동 등록되므로 승인 창이 뜨지 않는다.
const TEST_PROFILE = 'vitest-throwaway';
const TEST_ACCOUNT = 'vitest';
const TEST_VALUE = 'dummy-not-a-real-secret';

function security(args: string[]): Promise<number> {
  return new Promise(resolve => {
    execFile('/usr/bin/security', args, err => resolve(err ? ((err as any).code ?? -1) : 0));
  });
}

describe.skipIf(process.platform !== 'darwin')('KeychainSecretResolver — 실제 security(1)', () => {
  const secret = KeychainSecret.forProfile({ profile: TEST_PROFILE, account: TEST_ACCOUNT });

  afterAll(async () => {
    await security(['delete-generic-password', '-s', secret.service, '-a', secret.account]);
  });

  it('등록된 항목을 실제로 읽어온다', async () => {
    const added = await security([
      'add-generic-password', '-U', '-s', secret.service, '-a', secret.account, '-w', TEST_VALUE, '-A',
    ]);
    expect(added).toBe(0);
    await expect(KeychainSecretResolver.create().resolve(secret)).resolves.toBe(TEST_VALUE);
  });

  it('제한 시간 안에 안 끝나면 프로세스를 죽이고 timeout 으로 실패한다', async () => {
    const err = await KeychainSecretResolver.create({ timeoutMs: 1 }).resolve(secret).catch(e => e);
    expect(err.reason).toBe('timeout');
  });

  it('없는 항목은 not-found 로 실패한다', async () => {
    const missing = KeychainSecret.forProfile({ profile: 'vitest-absent', account: TEST_ACCOUNT });
    const err = await KeychainSecretResolver.create().resolve(missing).catch(e => e);
    expect(err.reason).toBe('not-found');
  });
});
