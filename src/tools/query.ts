import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';

export const queryInput = z.object({
  sql: z.string().min(1).describe('SELECT statement'),
  params: z.array(z.any()).optional().describe('Positional parameters'),
  maxRows: z.number().int().positive().optional().describe('Max rows to return'),
  timeoutMs: z.number().int().positive().optional().describe('Query timeout in ms'),
});

export const queryOutput = z.object({
  rows: z.array(z.any()),
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  truncated: z.boolean(),
  elapsedMs: z.number().int().nonnegative(),
});

export function registerQueryTool(server: McpServer, db: Database, defaults: { maxRows: number; timeoutMs: number }) {
  server.registerTool('query', {
    description: 'Execute a SELECT query and return rows with column metadata',
    inputSchema: queryInput,
    outputSchema: queryOutput,
  }, async ({ sql, params, maxRows, timeoutMs }: { sql: string; params?: any[] | undefined; maxRows?: number | undefined; timeoutMs?: number | undefined }) => {
    const res = await db.queryRows(sql, params ?? [], {
      maxRows: maxRows ?? defaults.maxRows,
      timeoutMs: timeoutMs ?? defaults.timeoutMs,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
      structuredContent: res,
    } as any;
  });
}
