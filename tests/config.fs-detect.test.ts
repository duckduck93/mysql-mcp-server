import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('config.ts docker detection via fs fallbacks', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('treats as docker when /.dockerenv exists', async () => {
    vi.mock('node:fs', () => ({
      default: {
        existsSync: (p: string) => p === '/.dockerenv',
        readFileSync: vi.fn(),
      },
    }));
    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig({ MYSQL_HOST: 'localhost', MYSQL_USER: 'u', MYSQL_DATABASE: 'd' } as any);
    expect(cfg.MYSQL_HOST).toBe('host.docker.internal');
  });

  it('treats as docker when /proc/1/cgroup contains docker', async () => {
    vi.mock('node:fs', () => ({
      default: {
        existsSync: (p: string) => p === '/proc/1/cgroup',
        readFileSync: (p: string) => '12:cpuset:/docker/abcdef',
      },
    }));
    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig({ MYSQL_HOST: '127.0.0.1', MYSQL_USER: 'u', MYSQL_DATABASE: 'd' } as any);
    expect(cfg.MYSQL_HOST).toBe('host.docker.internal');
  });

  it('treats as docker when /run/dockershim.sock exists', async () => {
    vi.mock('node:fs', () => ({
      default: {
        existsSync: (p: string) => p.endsWith('/run/dockershim.sock'),
        readFileSync: vi.fn(),
      },
    }));
    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig({ MYSQL_HOST: 'localhost', MYSQL_USER: 'u', MYSQL_DATABASE: 'd' } as any);
    expect(cfg.MYSQL_HOST).toBe('host.docker.internal');
  });
});
