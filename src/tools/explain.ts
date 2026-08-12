import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';
import { profileArg, type ProfileChoice } from './profile-arg.js';

export const explainOutput = z.object({
  plan: z.array(z.any())
});

export function buildExplainInput(choices: ProfileChoice[]) {
  return z.object({
    profile: profileArg(choices),
    sql: z.string().min(1).describe('SELECT statement to EXPLAIN'),
    params: z.array(z.any()).optional().describe('Positional parameters'),
  });
}

export function registerExplainTool(server: McpServer, db: Database, opts: { choices: ProfileChoice[] }) {
  server.registerTool('explain', {
    description: 'Return the execution plan for a SELECT statement',
    inputSchema: buildExplainInput(opts.choices),
    outputSchema: explainOutput,
  }, async ({ profile, sql, params }: { profile: string; sql: string; params?: any[] | undefined }) => {
    try {
      const plan = await db.explain({ profile, sql, params: params ?? [] });
      const res = { plan };
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      const ts = new Date().toISOString();
      const input = { profile, sql, params: params ?? [] };
      process.stderr.write(`[${ts}] tool explain failed: ${e.message}\ninput: ${JSON.stringify(input)}\nstack: ${e.stack ?? 'no-stack'}\n`);
      throw err;
    }
  });
}
