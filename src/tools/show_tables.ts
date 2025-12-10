import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
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
  }, async ({ includeViews }) => {
    const rows = await db.showTables(includeViews ?? false);
    const res = { tables: rows };
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
  });
}
