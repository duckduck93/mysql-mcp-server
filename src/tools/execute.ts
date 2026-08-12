import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';
import { profileArg, type ProfileChoice } from './profile-arg.js';

export const executeOutput = z.object({
  affectedRows: z.number().int().nonnegative(),
  insertId: z.number().int().optional(),
  warningStatus: z.number().int().optional(),
  elapsedMs: z.number().int().nonnegative(),
});

export function buildExecuteInput(choices: ProfileChoice[]) {
  return z.object({
    profile: profileArg(choices),
    sql: z.string().min(1).describe('Non-SELECT statement (DDL/DML)'),
    params: z.array(z.any()).optional().describe('Positional parameters'),
    timeoutMs: z.number().int().positive().optional().describe('Execution timeout in ms'),
  });
}

export function registerExecuteTool(
  server: McpServer,
  db: Database,
  opts: { choices: ProfileChoice[]; timeoutMs: number },
) {
  server.registerTool('execute', {
    description:
      'Execute a non-SELECT SQL (DDL/DML) and return affected rows, insertId, warnings. ' +
      '읽기 전용 프로파일에서는 거부된다.',
    inputSchema: buildExecuteInput(opts.choices),
    outputSchema: executeOutput,
  }, async ({ profile, sql, params, timeoutMs }: {
    profile: string; sql: string; params?: any[] | undefined; timeoutMs?: number | undefined;
  }) => {
    try {
      const res = await db.execute({ profile, sql, params: params ?? [], timeoutMs: timeoutMs ?? opts.timeoutMs });
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        structuredContent: res,
      } as any;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      const ts = new Date().toISOString();
      const input = { profile, sql, params: params ?? [], timeoutMs: timeoutMs ?? opts.timeoutMs };
      process.stderr.write(`[${ts}] tool execute failed: ${e.message}\ninput: ${JSON.stringify(input)}\nstack: ${e.stack ?? 'no-stack'}\n`);
      throw err;
    }
  });
}
