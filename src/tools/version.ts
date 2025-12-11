import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';

export const versionOutput = z.object({ version: z.string() });

export function registerVersionTool(server: McpServer, db: Database) {
  server.registerTool('version', {
    description: 'Return the MySQL server version string',
    inputSchema: {},
    outputSchema: versionOutput,
  }, async () => {
    try {
      const res = await db.version();
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      const ts = new Date().toISOString();
      process.stderr.write(`[${ts}] tool version failed: ${e.message}\ninput: {}\nstack: ${e.stack ?? 'no-stack'}\n`);
      throw err;
    }
  });
}
