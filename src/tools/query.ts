import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';
import { profileArg, type ProfileChoice } from './profile-arg.js';

export const queryOutput = z.object({
  rows: z.array(z.any()),
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  truncated: z.boolean(),
  elapsedMs: z.number().int().nonnegative(),
});

export function buildQueryInput(choices: ProfileChoice[]) {
  return z.object({
    profile: profileArg(choices),
    sql: z.string().min(1).describe('SELECT statement'),
    params: z.array(z.any()).optional().describe('Positional parameters'),
    maxRows: z.number().int().positive().optional().describe('Max rows to return (프로파일 상한을 넘지 못한다)'),
    timeoutMs: z.number().int().positive().optional().describe('Query timeout in ms'),
  });
}

export function registerQueryTool(
  server: McpServer,
  db: Database,
  opts: { choices: ProfileChoice[]; timeoutMs: number },
) {
  server.registerTool('query', {
    description: 'Execute a SELECT query and return rows with column metadata',
    inputSchema: buildQueryInput(opts.choices),
    outputSchema: queryOutput,
  }, async ({ profile, sql, params, maxRows, timeoutMs }: {
    profile: string; sql: string; params?: any[] | undefined; maxRows?: number | undefined; timeoutMs?: number | undefined;
  }) => {
    try {
      const args: { profile: string; sql: string; params: any[]; maxRows?: number; timeoutMs: number } = {
        profile, sql, params: params ?? [], timeoutMs: timeoutMs ?? opts.timeoutMs,
      };
      // maxRows 를 주지 않으면 넘기지 않는다. 그러면 프로파일 상한이 그대로 쓰인다.
      if (maxRows !== undefined) args.maxRows = maxRows;
      const res = await db.queryRows(args);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        structuredContent: res,
      } as any;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      const ts = new Date().toISOString();
      const input = { profile, sql, params: params ?? [], maxRows, timeoutMs: timeoutMs ?? opts.timeoutMs };
      process.stderr.write(`[${ts}] tool query failed: ${e.message}\ninput: ${JSON.stringify(input)}\nstack: ${e.stack ?? 'no-stack'}\n`);
      throw err;
    }
  });
}
