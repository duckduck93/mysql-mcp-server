import { z } from 'zod';
import { KeychainSecret } from './secret-resolver.js';

/**
 * 프로파일 파일의 한 항목이 지켜야 할 모양.
 *
 * 모르는 키를 거부한다. 비밀번호를 여기 적는 사고를 조용히 넘기지 않기 위해서다.
 */
const ProfileSchema = z
  .strictObject({
    host: z.string().min(1),
    port: z.number().int().positive(),
    database: z.string().min(1),
    user: z.string().min(1),

    // 열고 닫는 방식은 둘 중 하나만 쓴다. enabled 는 켜둔 채로, enabledUntil 은 시각으로 닫힌다.
    enabled: z.boolean().optional(),
    enabledUntil: z.string().nullable().optional(),

    readonly: z.boolean(),
    maxRows: z.number().int().positive(),
    timeoutMs: z.number().int().positive().optional(),

    // Agent 가 이 프로파일을 고르는 유일한 근거라 비워둘 수 없다.
    description: z.string().min(1),
  })
  .superRefine((raw, ctx) => {
    const byFlag = raw.enabled !== undefined;
    const byExpiry = raw.enabledUntil !== undefined;

    if (byFlag && byExpiry) {
      ctx.addIssue({
        code: 'custom',
        path: ['enabled'],
        message: 'enabled 와 enabledUntil 을 함께 쓸 수 없다. 여는 방식은 하나만 고른다',
      });
    }
    if (!byFlag && !byExpiry) {
      ctx.addIssue({
        code: 'custom',
        path: ['enabled'],
        message: 'enabled 또는 enabledUntil 중 하나는 있어야 한다. 기본값으로 열지 않는다',
      });
    }
    if (typeof raw.enabledUntil === 'string' && Number.isNaN(Date.parse(raw.enabledUntil))) {
      ctx.addIssue({
        code: 'custom',
        path: ['enabledUntil'],
        message: 'enabledUntil 을 시각으로 읽을 수 없다',
      });
    }
  });

/** 프로파일을 여닫는 방식. 켜둔 채로 두거나(flag), 시각이 지나면 저절로 닫히거나(until). */
type Gate = { kind: 'flag'; open: boolean } | { kind: 'until'; until: Date | null };

/** 닫힌 프로파일에 붙으려 했을 때. 문구는 Agent 가 우회하지 않고 사용자에게 묻도록 쓴다. */
export class ProfileClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileClosedError';
  }
}

/** 읽기 전용 프로파일로 쓰기를 시도했을 때. */
export class ProfileWriteDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileWriteDeniedError';
  }
}

/**
 * DB 접속 자격 한 세트와 그에 대한 정책.
 *
 * 열려 있는지·쓸 수 있는지를 스스로 판정한다. 호출부에 `if` 를 흘리지 않기 위해
 * 판정 결과를 묻는 메서드와 어긋나면 던지는 메서드를 함께 둔다.
 */
export class Profile {
  private constructor(
    readonly name: string,
    readonly host: string,
    readonly port: number,
    readonly database: string,
    readonly user: string,
    readonly maxRows: number,
    readonly timeoutMs: number | undefined,
    readonly description: string,
    private readonly gate: Gate,
    private readonly readonlyAccess: boolean,
  ) {}

  /**
   * 프로파일 파일의 한 항목을 검증해 값객체로 만든다.
   *
   * @param name 프로파일 이름. Keychain 서비스명과 오류 메시지에 쓰인다
   * @param raw 파일에서 읽은 그대로의 값
   */
  static from({ name, raw }: { name: string; raw: unknown }): Profile {
    if (!name.trim()) throw new Error('프로파일 이름이 비어 있다.');

    const parsed = ProfileSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(issue => `${issue.path.join('.') || '(전체)'} — ${issue.message}`)
        .join('; ');
      throw new Error(`프로파일 '${name}' 설정이 잘못됐다: ${detail}`);
    }

    const p = parsed.data;
    const gate: Gate =
      p.enabled !== undefined
        ? { kind: 'flag', open: p.enabled }
        : { kind: 'until', until: p.enabledUntil ? new Date(p.enabledUntil) : null };

    return new Profile(
      name, p.host, p.port, p.database, p.user,
      p.maxRows, p.timeoutMs, p.description,
      gate, p.readonly,
    );
  }

  /** 비밀번호가 어디에 있는지. 값은 여기서 꺼내지 않는다. */
  secretLocation(): KeychainSecret {
    return KeychainSecret.forProfile({ profile: this.name, account: this.user });
  }

  isOpenAt(now: Date): boolean {
    if (this.gate.kind === 'flag') return this.gate.open;
    return this.gate.until !== null && this.gate.until.getTime() > now.getTime();
  }

  allowsWrite(): boolean {
    return !this.readonlyAccess;
  }

  /** 닫혀 있으면 던진다. 사용자가 열어야 한다는 것을 문구로 못박는다. */
  assertOpenAt(now: Date): void {
    if (this.isOpenAt(now)) return;

    const expired =
      this.gate.kind === 'until' && this.gate.until !== null && this.gate.until.getTime() <= now.getTime();
    const why = expired
      ? `열어둔 시각(${this.gate.kind === 'until' ? this.gate.until?.toISOString() : ''})이 만료됐다`
      : '닫혀 있다';

    throw new ProfileClosedError(
      `프로파일 '${this.name}' 은 ${why}. 사용자가 열어야 조회할 수 있으니 임의로 다른 프로파일을 쓰지 말고 사용자에게 요청한다.`,
    );
  }

  /** 읽기 전용이면 던진다. */
  assertWritable(): void {
    if (this.allowsWrite()) return;
    throw new ProfileWriteDeniedError(
      `프로파일 '${this.name}' 은 읽기 전용이라 쓰기 도구를 쓸 수 없다.`,
    );
  }
}
