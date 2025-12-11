import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';

export const showTablesInput = z.object({
  includeViews: z.boolean().optional().describe('Include views in the list (default: false)')
});

export const showTablesOutput = z.object({
  tables: z.array(z.object({ name: z.string(), type: z.enum(['BASE TABLE', 'VIEW']) }))
});

export function registerShowTablesTool(server: McpServer, db: Database) {
  server.registerTool('show_tables', {
    description: 'List tables in the current database (optionally include views)',
    inputSchema: showTablesInput,
    outputSchema: showTablesOutput,
  }, async ({ includeViews }: { includeViews?: boolean | undefined }) => {
    try {
      const rows = await db.showTables(includeViews ?? false);
      const res = { tables: rows };
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      const ts = new Date().toISOString();
      const input = { includeViews: includeViews ?? false };
      const details: Record<string, any> = {};
      // Surface common mysql2 error fields if present
      for (const k of ['code', 'errno', 'sql', 'sqlState', 'sqlMessage']) {
        if ((err as any)?.[k] !== undefined) details[k] = (err as any)[k];
      }
      const msg = e.message && e.message.trim().length > 0 ? e.message : (details.sqlMessage || details.code || '');
      process.stderr.write(`[${ts}] tool show_tables failed: ${msg}\ninput: ${JSON.stringify(input)}\ndetails: ${JSON.stringify(details)}\nstack: ${e.stack ?? 'no-stack'}\n`);
      throw err;
    }
  });
}
