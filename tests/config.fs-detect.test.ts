import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock 은 파일당 하나만 살아남으므로(호이스팅) 테스트마다 갈아끼울 수 있는 상태를 둔다.
const fsState = vi.hoisted(() => ({ exists: (_path: string) => false }));

vi.mock('node:fs', () => ({
  default: {
    existsSync: (p: string) => fsState.exists(p),
    readFileSync: vi.fn(),
  },
}));

async function resolveHostWith(exists: (path: string) => boolean, host: string) {
  fsState.exists = exists;
  const { resolveHost } = await import('../src/config.js');
  return resolveHost(host, {} as any);
}

describe('resolveHost — 파일 흔적으로 도커를 알아본다', () => {
  beforeEach(() => {
    vi.resetModules();
    fsState.exists = () => false;
  });

  it('/.dockerenv 가 있으면 도커로 본다', async () => {
    expect(await resolveHostWith(p => p === '/.dockerenv', 'localhost')).toBe('host.docker.internal');
  });

  it('/proc/1/cgroup 이 있으면 도커로 본다', async () => {
    expect(await resolveHostWith(p => p === '/proc/1/cgroup', '127.0.0.1')).toBe('host.docker.internal');
  });

  it('/run/dockershim.sock 이 있으면 도커로 본다', async () => {
    expect(await resolveHostWith(p => p.endsWith('/run/dockershim.sock'), 'localhost')).toBe('host.docker.internal');
  });

  it('도커 흔적이 없으면 그대로 둔다', async () => {
    expect(await resolveHostWith(() => false, 'localhost')).toBe('localhost');
  });
});
