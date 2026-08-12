import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';
import { profileArg, type ProfileChoice } from './profile-arg.js';

export const versionOutput = z.object({ version: z.string() });

export function buildVersionInput(choices: ProfileChoice[]) {
  return z.object({ profile: profileArg(choices) });
}

export function registerVersionTool(server: McpServer, db: Database, opts: { choices: ProfileChoice[] }) {
  server.registerTool('version', {
    description: 'Return the MySQL server version string',
    inputSchema: buildVersionInput(opts.choices),
    outputSchema: versionOutput,
  }, async ({ profile }: { profile: string }) => {
    try {
      const res = await db.version({ profile });
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      const ts = new Date().toISOString();
      process.stderr.write(`[${ts}] tool version failed: ${e.message}\ninput: ${JSON.stringify({ profile })}\nstack: ${e.stack ?? 'no-stack'}\n`);
      throw err;
    }
  });
}
