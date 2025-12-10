import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import type { Database } from '../db.js';

export const describeTableInput = z.object({
  table: z.string().min(1).describe('Table name to describe'),
});

export const describeTableOutput = z.object({
  table: z.string(),
  columns: z.array(z.object({
    name: z.string(),
    type: z.string(),
    nullable: z.boolean(),
    default: z.any().optional(),
    key: z.string().optional(),
    extra: z.string().optional(),
    comment: z.string().optional(),
  })),
  tableComment: z.string().optional(),
});

export function registerDescribeTableTool(server: McpServer, db: Database) {
  server.registerTool('describe_table', {
    description: 'Describe the schema and comments for a given table',
    inputSchema: describeTableInput,
    outputSchema: describeTableOutput,
  }, async ({ table }) => {
    const res = await db.describeTable(table);
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
  });
}
