import { describe, it, expect } from 'vitest';
import { ProfileRegistry, UnknownProfileError } from '../src/profile-registry.js';

const DEV = {
  host: 'h1', port: 3306, database: 'd', user: 'u1',
  enabled: true, readonly: false, maxRows: 100,
  description: '개발용. 평소 이걸 쓴다',
};
const PROD = {
  host: 'h2', port: 3306, database: 'd', user: 'u2',
  enabledUntil: null, readonly: true, maxRows: 10, timeoutMs: 15000,
  description: '운영용. 사용자가 열어줄 때만',
};

/** 내용을 갈아끼울 수 있는 가짜 파일. 읽은 횟수를 센다. */
function fakeFile(initial: unknown) {
  const state = { text: JSON.stringify(initial), reads: 0 };
  const read = (_path: string) => {
    state.reads++;
    return state.text;
  };
  return {
    read,
    get reads() { return state.reads; },
    replaceWith(next: unknown) { state.text = JSON.stringify(next); },
    corrupt() { state.text = '{ not json'; },
  };
}

const registryOf = (contents: unknown) => {
  const file = fakeFile(contents);
  return { registry: ProfileRegistry.withReader('profiles.json', file.read), file };
};

describe('ProfileRegistry — 이름으로 프로파일을 준다', () => {
  it('이름으로 찾아 돌려준다', () => {
    const { registry } = registryOf({ dev: DEV, prod: PROD });
    expect(registry.get('dev').host).toBe('h1');
    expect(registry.get('prod').maxRows).toBe(10);
  });

  it('모르는 이름이면 유효 목록과 함께 실패한다', () => {
    const { registry } = registryOf({ dev: DEV, prod: PROD });
    let caught: any;
    try { registry.get('stage'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnknownProfileError);
    expect(caught.message).toContain('stage');
    expect(caught.message).toContain('dev');
    expect(caught.message).toContain('prod');
  });

  it('이름 목록과 선택 근거를 함께 노출한다', () => {
    const { registry } = registryOf({ dev: DEV, prod: PROD });
    expect(registry.names()).toEqual(['dev', 'prod']);
    expect(registry.choices()).toEqual([
      { name: 'dev', description: DEV.description },
      { name: 'prod', description: PROD.description },
    ]);
  });
});

describe('ProfileRegistry — 매 호출 다시 읽는다', () => {
  it('호출할 때마다 파일을 읽는다', () => {
    const { registry, file } = registryOf({ dev: DEV });
    registry.get('dev');
    registry.get('dev');
    registry.names();
    expect(file.reads).toBe(3);
  });

  it('파일이 바뀌면 다음 호출부터 반영된다 — 재시작이 필요 없다', () => {
    const { registry, file } = registryOf({ dev: DEV });
    expect(registry.get('dev').isOpenAt(new Date())).toBe(true);

    file.replaceWith({ dev: { ...DEV, enabled: false } });
    expect(registry.get('dev').isOpenAt(new Date())).toBe(false);
  });

  it('프로파일이 새로 생기면 다음 호출부터 보인다', () => {
    const { registry, file } = registryOf({ dev: DEV });
    expect(registry.names()).toEqual(['dev']);
    file.replaceWith({ dev: DEV, prod: PROD });
    expect(registry.names()).toEqual(['dev', 'prod']);
  });
});

describe('ProfileRegistry — 읽을 수 없으면 즉시 실패한다', () => {
  it('JSON 이 깨졌으면 파일 경로와 함께 실패한다', () => {
    const { registry, file } = registryOf({ dev: DEV });
    file.corrupt();
    expect(() => registry.get('dev')).toThrow(/profiles\.json/);
  });

  it('파일이 없으면 만드는 방법을 안내한다', () => {
    const registry = ProfileRegistry.withReader('profiles.json', () => {
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    expect(() => registry.get('dev')).toThrow(/profiles\.example\.json/);
  });

  it('프로파일 하나가 잘못됐으면 그 이름을 지목한다', () => {
    const { registry } = registryOf({ dev: DEV, broken: { ...PROD, host: '' } });
    expect(() => registry.get('broken')).toThrow(/broken/);
  });

  it('비어 있는 파일이면 실패한다', () => {
    const { registry } = registryOf({});
    expect(() => registry.names()).toThrow(/비어/);
  });
});
