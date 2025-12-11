import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';

export const executeInput = z.object({
  sql: z.string().min(1).describe('Non-SELECT statement (DDL/DML)'),
  params: z.array(z.any()).optional().describe('Positional parameters'),
  timeoutMs: z.number().int().positive().optional().describe('Execution timeout in ms'),
});

export const executeOutput = z.object({
  affectedRows: z.number().int().nonnegative(),
  insertId: z.number().int().optional(),
  warningStatus: z.number().int().optional(),
  elapsedMs: z.number().int().nonnegative(),
});

export function registerExecuteTool(server: McpServer, db: Database, defaults: { timeoutMs: number }) {
  server.registerTool('execute', {
    description: 'Execute a non-SELECT SQL (DDL/DML) and return affected rows, insertId, warnings',
    inputSchema: executeInput,
    outputSchema: executeOutput,
  }, async ({ sql, params, timeoutMs }: { sql: string; params?: any[] | undefined; timeoutMs?: number | undefined }) => {
    const res = await db.execute(sql, params ?? [], { timeoutMs: timeoutMs ?? defaults.timeoutMs });
    return {
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      structuredContent: res,
    } as any;
  });
}
