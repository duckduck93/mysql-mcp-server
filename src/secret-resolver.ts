import { execFile } from 'node:child_process';

/**
 * Keychain 에 저장된 비밀번호 하나의 위치.
 *
 * 서비스명은 `mysql-mcp/<프로파일명>` 관례로 고정한다. 프로파일 파일에 서비스명을
 * 적지 않고 프로파일명에서 유도하기 위한 것이다.
 */
export class KeychainSecret {
  private constructor(
    readonly service: string,
    readonly account: string,
  ) {}

  /**
   * 프로파일명과 DB 계정으로 Keychain 위치를 만든다.
   *
   * @param profile 프로파일명. 서비스명 `mysql-mcp/<profile>` 로 쓰인다
   * @param account DB 계정. Keychain 항목의 account 로 쓰인다
   */
  static forProfile({ profile, account }: { profile: string; account: string }): KeychainSecret {
    if (!profile.trim()) throw new Error('프로파일명이 비어 있어 Keychain 서비스명을 만들 수 없다.');
    if (!account.trim()) throw new Error('계정이 비어 있어 Keychain 항목을 특정할 수 없다.');
    return new KeychainSecret(`mysql-mcp/${profile}`, account);
  }

  /** 항목이 없을 때 사용자에게 안내할 등록 명령. 비밀번호는 대화형으로 입력받아 셸 히스토리에 남지 않는다. */
  registerCommand(): string {
    return `security add-generic-password -U -s "${this.service}" -a "${this.account}" -w`;
  }

  /** 로그·에러 표기용. 값은 담지 않는다. */
  toString(): string {
    return `${this.service} (${this.account})`;
  }
}

export type KeychainFailureReason = 'not-found' | 'denied' | 'timeout' | 'empty' | 'failed';

/** Keychain 조회 실패. 어떤 이유든 폴백 없이 이 예외로 끝난다. */
export class KeychainSecretError extends Error {
  private constructor(
    readonly reason: KeychainFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'KeychainSecretError';
  }

  static notFound(secret: KeychainSecret): KeychainSecretError {
    return new KeychainSecretError(
      'not-found',
      `Keychain 에 ${secret} 항목이 없다. 다음으로 등록한 뒤 다시 시도한다.\n  ${secret.registerCommand()}`,
    );
  }

  static denied(secret: KeychainSecret): KeychainSecretError {
    return new KeychainSecretError('denied', `Keychain ${secret} 접근이 거부됐다. 승인 창에서 허용해야 조회된다.`);
  }

  static timedOut(secret: KeychainSecret): KeychainSecretError {
    return new KeychainSecretError('timeout', `Keychain ${secret} 승인을 기다리다 시간이 초과됐다.`);
  }

  static empty(secret: KeychainSecret): KeychainSecretError {
    return new KeychainSecretError('empty', `Keychain ${secret} 항목이 비어 있다. 비밀번호를 다시 등록해야 한다.`);
  }

  static failed(secret: KeychainSecret, code: number | null): KeychainSecretError {
    return new KeychainSecretError('failed', `Keychain ${secret} 조회가 실패했다. security 종료코드 ${code}.`);
  }
}

/** 비밀번호를 꺼내오는 창구. 플랫폼별 구현을 갈아끼우고 테스트에서 대역을 넣기 위한 경계다. */
export interface SecretResolver {
  resolve(secret: KeychainSecret): Promise<string>;
}

export type SecretSource = 'keychain' | 'env';

export type SecurityRunResult = {
  /** 정상 종료면 0, 실패면 security 종료코드. 신호로 죽었으면 null */
  code: number | null;
  stdout: string;
  /** 타임아웃 등으로 강제 종료됐는지 */
  killed?: boolean;
};

export type SecurityRunner = (args: readonly string[]) => Promise<SecurityRunResult>;

const SECURITY_BIN = '/usr/bin/security';

/** security(1) 종료코드. 실측으로 확인했다. */
const EXIT_ITEM_NOT_FOUND = 44;
const EXIT_USER_CANCELED = 128;

/**
 * macOS Keychain 에서 비밀번호를 꺼내는 조회기.
 *
 * 환경변수 폴백은 두지 않는다. 폴백이 있으면 게이트가 그 하나로 뚫린다.
 */
export class KeychainSecretResolver implements SecretResolver {
  private constructor(private readonly run: SecurityRunner) {}

  /**
   * 실제 `security` 명령을 태우는 조회기.
   *
   * @param timeoutMs 승인 창을 아무도 누르지 않을 때 포기할 시간
   */
  static create({ timeoutMs = 60_000 }: { timeoutMs?: number } = {}): KeychainSecretResolver {
    return new KeychainSecretResolver(
      args =>
        new Promise<SecurityRunResult>(resolve => {
          execFile(SECURITY_BIN, [...args], { timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, stdout) => {
            if (!err) return resolve({ code: 0, stdout, killed: false });
            const code = typeof (err as any).code === 'number' ? ((err as any).code as number) : null;
            resolve({ code, stdout, killed: (err as any).killed === true });
          });
        }),
    );
  }

  /** 테스트용. security 를 부르지 않고 주어진 러너로 대체한다. */
  static withRunner(run: SecurityRunner): KeychainSecretResolver {
    return new KeychainSecretResolver(run);
  }

  async resolve(secret: KeychainSecret): Promise<string> {
    const { code, stdout, killed } = await this.run([
      'find-generic-password',
      '-s',
      secret.service,
      '-a',
      secret.account,
      '-w',
    ]);

    if (killed) throw KeychainSecretError.timedOut(secret);
    if (code === EXIT_ITEM_NOT_FOUND) throw KeychainSecretError.notFound(secret);
    if (code === EXIT_USER_CANCELED) throw KeychainSecretError.denied(secret);
    if (code !== 0) throw KeychainSecretError.failed(secret, code);

    // security 는 값 뒤에 개행 하나를 붙인다. 값 자체의 공백은 건드리지 않는다.
    const password = stdout.replace(/\n$/, '');
    if (password.length === 0) throw KeychainSecretError.empty(secret);
    return password;
  }
}

/**
 * 환경변수 `MYSQL_PASSWORD` 에서 비밀번호를 읽는 조회기.
 *
 * 아직 안전한 저장소 구현이 없는 플랫폼(Windows·Linux)을 위한 것이다.
 * Keychain 조회가 실패했을 때 이쪽으로 흘러오는 경로는 없다 — 출처는 기동 시점에 하나만 고른다.
 */
export class EnvSecretResolver implements SecretResolver {
  private constructor(private readonly env: Record<string, string | undefined>) {}

  static fromEnv(env: Record<string, string | undefined>): EnvSecretResolver {
    return new EnvSecretResolver(env);
  }

  async resolve(secret: KeychainSecret): Promise<string> {
    const password = this.env.MYSQL_PASSWORD;
    if (!password) {
      throw new Error(`MYSQL_SECRET_SOURCE=env 인데 ${secret} 에 쓸 MYSQL_PASSWORD 가 비어 있다.`);
    }
    return password;
  }
}

/**
 * 선언된 출처에 맞는 조회기를 만든다. 출처는 여기서 한 번만 정해지고 이후 바뀌지 않는다.
 *
 * @param source 비밀번호 출처. 기본은 keychain
 * @param env 환경변수. source=env 일 때 비밀번호를 읽는 곳
 * @param platform 실행 플랫폼. keychain 은 macOS 에서만 동작한다
 */
export function createSecretResolver({
  source = 'keychain',
  env,
  platform = process.platform,
}: {
  source?: SecretSource;
  env: Record<string, string | undefined>;
  platform?: string;
}): SecretResolver {
  if (source === 'env') return EnvSecretResolver.fromEnv(env);
  if (platform !== 'darwin') {
    throw new Error(
      `MYSQL_SECRET_SOURCE=keychain 은 macOS 에서만 동작한다(현재 ${platform}). ` +
        '이 플랫폼에서는 MYSQL_SECRET_SOURCE=env 로 두고 MYSQL_PASSWORD 를 설정한다.',
    );
  }
  return KeychainSecretResolver.create();
}
