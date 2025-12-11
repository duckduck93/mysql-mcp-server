import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';

export const showIndexesInput = z.object({
  table: z.string().min(1).describe('Table name to list indexes for'),
});

export const showIndexesOutput = z.object({
  table: z.string(),
  indexes: z.array(z.object({
    name: z.string(),
    columns: z.array(z.string()),
    unique: z.boolean(),
    visible: z.boolean().optional(),
    comment: z.string().optional(),
    type: z.string().optional(),
  }))
});

export function registerShowIndexesTool(server: McpServer, db: Database) {
  server.registerTool('show_indexes', {
    description: 'Show index definitions for a given table',
    inputSchema: showIndexesInput,
    outputSchema: showIndexesOutput,
  }, async ({ table }: { table: string }) => {
    const res = await db.showIndexes(table);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
  });
}
