import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profile } from './profile.js';

/** 없는 프로파일을 달라고 했을 때. 유효한 이름을 함께 알려 Agent 가 되묻지 않게 한다. */
export class UnknownProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownProfileError';
  }
}

export type ProfileChoice = { name: string; description: string };

type FileReader = (path: string) => string;

/**
 * `profiles.json` 을 읽어 `Profile` 을 돌려주는 일급 컬렉션.
 *
 * **매 호출마다 파일을 다시 읽는다.** 그래야 파일을 저장하는 순간 차단이 걸리고,
 * 급히 끊을 때 서버를 재시작할 필요가 없다.
 */
export class ProfileRegistry {
  private constructor(
    private readonly path: string,
    private readonly read: FileReader,
  ) {}

  /** 실제 파일을 읽는 레지스트리. */
  static atPath(filePath: string): ProfileRegistry {
    return new ProfileRegistry(filePath, p => fs.readFileSync(p, 'utf8'));
  }

  /** 테스트용. 파일 대신 주어진 리더를 쓴다. */
  static withReader(filePath: string, read: FileReader): ProfileRegistry {
    return new ProfileRegistry(filePath, read);
  }

  /**
   * 프로파일 파일의 기본 위치.
   *
   * `MYSQL_PROFILES` 가 있으면 그것을, 없으면 패키지 기준 경로를 쓴다.
   * `process.cwd()` 는 쓰지 않는다 — MCP 서버는 어디서 실행될지 모른다.
   */
  static defaultPath(env: Record<string, string | undefined> = process.env): string {
    if (env.MYSQL_PROFILES) return path.resolve(env.MYSQL_PROFILES);
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', 'profiles.json');
  }

  get(name: string): Profile {
    const profiles = this.load();
    const found = profiles.get(name);
    if (!found) {
      throw new UnknownProfileError(
        `알 수 없는 프로파일 '${name}'. 사용 가능한 프로파일: ${[...profiles.keys()].join(', ')}`,
      );
    }
    return found;
  }

  names(): string[] {
    return [...this.load().keys()];
  }

  /** 도구 인자 enum 에 실을 후보와 선택 근거. */
  choices(): ProfileChoice[] {
    return [...this.load().values()].map(p => ({ name: p.name, description: p.description }));
  }

  private load(): Map<string, Profile> {
    const raw = this.readFile();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${this.path} 을 JSON 으로 읽을 수 없다: ${(err as Error).message}`);
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${this.path} 은 프로파일 이름을 키로 갖는 객체여야 한다.`);
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) {
      throw new Error(`${this.path} 이 비어 있다. 프로파일을 하나 이상 정의해야 한다.`);
    }

    return new Map(entries.map(([name, raw]) => [name, Profile.from({ name, raw })]));
  }

  private readFile(): string {
    try {
      return this.read(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `${this.path} 이 없다. profiles.example.json 을 복사해 접속정보를 채운 뒤 다시 시도한다.`,
        );
      }
      throw err;
    }
  }
}
