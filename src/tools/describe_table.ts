import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';
import { profileArg, type ProfileChoice } from './profile-arg.js';

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

export function buildDescribeTableInput(choices: ProfileChoice[]) {
  return z.object({
    profile: profileArg(choices),
    table: z.string().min(1).describe('Table name to describe'),
  });
}

export function registerDescribeTableTool(server: McpServer, db: Database, opts: { choices: ProfileChoice[] }) {
  server.registerTool('describe_table', {
    description: 'Describe the schema and comments for a given table',
    inputSchema: buildDescribeTableInput(opts.choices),
    outputSchema: describeTableOutput,
  }, async ({ profile, table }: { profile: string; table: string }) => {
    try {
      const res = await db.describeTable({ profile, table });
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      const ts = new Date().toISOString();
      const input = { profile, table };
      process.stderr.write(`[${ts}] tool describe_table failed: ${e.message}\ninput: ${JSON.stringify(input)}\nstack: ${e.stack ?? 'no-stack'}\n`);
      throw err;
    }
  });
}
