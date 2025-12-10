import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import type { Database } from '../db.js';

export const explainInput = z.object({
  sql: z.string().min(1).describe('SELECT statement to EXPLAIN'),
  params: z.array(z.any()).optional().describe('Positional parameters'),
});

export const explainOutput = z.object({
  plan: z.array(z.any())
});

export function registerExplainTool(server: McpServer, db: Database) {
  server.registerTool('explain', {
    description: 'Return the execution plan for a SELECT statement',
    inputSchema: explainInput,
    outputSchema: explainOutput,
  }, async ({ sql, params }) => {
    const plan = await db.explain(sql, params ?? []);
    const res = { plan };
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
  });
}
