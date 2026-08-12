import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Database } from '../db.js';

export const profilesOutput = z.object({
  profiles: z.array(z.object({
    name: z.string(),
    description: z.string(),
    open: z.boolean(),
    readonly: z.boolean(),
    production: z.boolean(),
    maxRows: z.number().int().positive(),
    expiresAt: z.string().optional(),
  })),
});

export function registerProfilesTool(server: McpServer, db: Database) {
  server.registerTool('profiles', {
    description:
      '조회할 수 있는 DB 프로파일과 각각의 열림 상태를 돌려준다. ' +
      '어느 프로파일로 물어야 할지 모를 때, 또는 프로파일이 닫혀 있다는 응답을 받았을 때 부른다. ' +
      'open=false 인 프로파일은 사용자가 열어야 하며 Agent 가 열 수 없다.',
    inputSchema: {},
    outputSchema: profilesOutput,
  }, async () => {
    try {
      const res = { profiles: db.listProfiles() };
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], structuredContent: res } as any;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      const ts = new Date().toISOString();
      process.stderr.write(`[${ts}] tool profiles failed: ${e.message}\nstack: ${e.stack ?? 'no-stack'}\n`);
      throw err;
    }
  });
}
