import { describe, it, expect } from 'vitest';
import { Profile, ProfileClosedError, ProfileWriteDeniedError } from '../src/profile.js';

const NOW = new Date('2026-08-12T10:00:00Z');

function raw(overrides: Record<string, unknown> = {}) {
  return {
    host: 'h', port: 3306, database: 'd', user: 'u',
    enabled: true, readonly: false, maxRows: 100, production: false,
    description: '언제 이걸 쓰는지',
    ...overrides,
  };
}

const profile = (overrides: Record<string, unknown> = {}) =>
  Profile.from({ name: 'dev', raw: raw(overrides) });

describe('Profile — 접속정보', () => {
  it('정적 팩토리로 만들고 접속정보를 노출한다', () => {
    const p = profile();
    expect(p.name).toBe('dev');
    expect(p.host).toBe('h');
    expect(p.port).toBe(3306);
    expect(p.database).toBe('d');
    expect(p.user).toBe('u');
    expect(p.description).toBe('언제 이걸 쓰는지');
  });

  it('비밀번호 위치를 스스로 안다', () => {
    const secret = profile().secretLocation();
    expect(secret.service).toBe('mysql-mcp/dev');
    expect(secret.account).toBe('u');
  });

  it('비밀번호는 프로파일에 실리지 않는다', () => {
    expect(JSON.stringify(profile())).not.toContain('password');
    expect(() => Profile.from({ name: 'dev', raw: raw({ password: 'p' }) })).toThrow(/password/);
  });
});

describe('Profile — 필수값이 빠지면 즉시 실패한다', () => {
  it.each([
    ['host', { host: '' }],
    ['port', { port: 0 }],
    ['database', { database: '' }],
    ['user', { user: '' }],
    ['maxRows', { maxRows: 0 }],
    ['readonly', { readonly: undefined }],
    ['description', { description: '' }],
  ])('%s 가 비면 실패한다', (field, override) => {
    expect(() => Profile.from({ name: 'dev', raw: raw(override) })).toThrow(new RegExp(field));
  });

  it('실패 메시지에 프로파일 이름이 들어간다', () => {
    expect(() => Profile.from({ name: 'staging', raw: raw({ host: '' }) })).toThrow(/staging/);
  });

  it('이름이 비면 실패한다', () => {
    expect(() => Profile.from({ name: '', raw: raw() })).toThrow();
  });
});

describe('Profile — 열림 여부를 스스로 판정한다', () => {
  it('enabled=true 면 열려 있다', () => {
    expect(profile({ enabled: true }).isOpenAt(NOW)).toBe(true);
  });

  it('enabled=false 면 닫혀 있다', () => {
    expect(profile({ enabled: false }).isOpenAt(NOW)).toBe(false);
  });

  it('enabledUntil 이 미래면 열려 있다', () => {
    const p = profile({ enabled: undefined, enabledUntil: '2026-08-12T11:00:00Z' });
    expect(p.isOpenAt(NOW)).toBe(true);
  });

  it('enabledUntil 이 지났으면 닫혀 있다', () => {
    const p = profile({ enabled: undefined, enabledUntil: '2026-08-12T09:59:59Z' });
    expect(p.isOpenAt(NOW)).toBe(false);
  });

  it('enabledUntil 이 null 이면 닫혀 있다', () => {
    const p = profile({ enabled: undefined, enabledUntil: null });
    expect(p.isOpenAt(NOW)).toBe(false);
  });

  it('enabled 와 enabledUntil 을 둘 다 주면 모호하므로 실패한다', () => {
    expect(() => Profile.from({ name: 'dev', raw: raw({ enabled: true, enabledUntil: null }) }))
      .toThrow(/enabled|enabledUntil/);
  });

  it('둘 다 없으면 실패한다 — 기본값으로 열지 않는다', () => {
    expect(() => Profile.from({ name: 'dev', raw: raw({ enabled: undefined }) }))
      .toThrow(/enabled|enabledUntil/);
  });

  it('enabledUntil 이 시각으로 못 읽히면 실패한다', () => {
    expect(() => Profile.from({ name: 'dev', raw: raw({ enabled: undefined, enabledUntil: '어제' }) }))
      .toThrow(/enabledUntil/);
  });
});

describe('Profile — 운영 여부는 별도 플래그로 선언한다', () => {
  it('production 플래그를 그대로 노출한다', () => {
    expect(profile({ production: false }).isProduction).toBe(false);
    expect(profile({
      production: true, enabled: undefined, enabledUntil: null,
    }).isProduction).toBe(true);
  });

  it('production 을 빠뜨리면 실패한다 — 안전 플래그에 조용한 기본값을 두지 않는다', () => {
    const { production, ...withoutFlag } = raw();
    expect(() => Profile.from({ name: 'dev', raw: withoutFlag })).toThrow(/production/);
  });

  it('운영인데 enabled 로 상시 열어두면 실패한다', () => {
    expect(() => Profile.from({ name: 'prod', raw: raw({ production: true, enabled: true }) }))
      .toThrow(/enabledUntil/);
  });

  it('운영은 enabledUntil 로만 연다', () => {
    expect(() => Profile.from({
      name: 'prod',
      raw: raw({ production: true, enabled: undefined, enabledUntil: '2026-08-12T11:00:00Z' }),
    })).not.toThrow();
  });
});

describe('Profile — 표시에 필요한 정보를 노출한다', () => {
  it('enabled 방식은 게이트 대상이 아니다', () => {
    const p = profile({ enabled: true });
    expect(p.isGated).toBe(false);
    expect(p.expiresAt).toBeUndefined();
  });

  it('enabledUntil 방식은 게이트 대상이고 만료 시각을 준다', () => {
    const p = profile({ enabled: undefined, enabledUntil: '2026-08-12T11:00:00Z' });
    expect(p.isGated).toBe(true);
    expect(p.expiresAt?.toISOString()).toBe('2026-08-12T11:00:00.000Z');
  });

  it('닫혀 있는 게이트 프로파일은 만료 시각이 없다', () => {
    const p = profile({ enabled: undefined, enabledUntil: null });
    expect(p.isGated).toBe(true);
    expect(p.expiresAt).toBeUndefined();
  });
});

describe('Profile — 닫혀 있으면 사용자에게 물으라고 실패한다', () => {
  it('닫힌 프로파일은 사용자가 켜야 한다고 말한다', () => {
    const p = profile({ enabled: false });
    let caught: any;
    try { p.assertOpenAt(NOW); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ProfileClosedError);
    expect(caught.message).toContain('dev');
    expect(caught.message).toMatch(/사용자/);
  });

  it('만료된 프로파일은 만료됐다고 말한다', () => {
    const p = profile({ enabled: undefined, enabledUntil: '2026-08-12T09:00:00Z' });
    expect(() => p.assertOpenAt(NOW)).toThrow(/만료/);
  });

  it('열린 프로파일은 통과시킨다', () => {
    expect(() => profile().assertOpenAt(NOW)).not.toThrow();
  });
});

describe('Profile — 쓰기 허용 여부를 스스로 판정한다', () => {
  it('readonly=false 면 쓰기를 통과시킨다', () => {
    expect(() => profile({ readonly: false }).assertWritable()).not.toThrow();
    expect(profile({ readonly: false }).allowsWrite()).toBe(true);
  });

  it('readonly=true 면 쓰기를 거부한다', () => {
    const p = profile({ readonly: true });
    expect(p.allowsWrite()).toBe(false);
    let caught: any;
    try { p.assertWritable(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ProfileWriteDeniedError);
    expect(caught.message).toContain('dev');
  });
});

describe('Profile — 조회 상한', () => {
  it('maxRows 를 돌려준다', () => {
    expect(profile({ maxRows: 500 }).maxRows).toBe(500);
  });

  it('timeoutMs 는 선택이고 없으면 undefined 다', () => {
    expect(profile().timeoutMs).toBeUndefined();
    expect(profile({ timeoutMs: 15000 }).timeoutMs).toBe(15000);
  });

  it('timeoutMs 가 양수가 아니면 실패한다', () => {
    expect(() => Profile.from({ name: 'dev', raw: raw({ timeoutMs: 0 }) })).toThrow(/timeoutMs/);
  });
});
