import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import type { Database } from '../db.js';

export const versionOutput = z.object({ version: z.string() });

export function registerVersionTool(server: McpServer, db: Database) {
  server.registerTool('version', {
    description: 'Return the MySQL server version string',
    inputSchema: {},
    outputSchema: versionOutput,
  }, async () => {
    const res = await db.version();
    return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
  });
}
