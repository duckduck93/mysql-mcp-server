#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { ConnectionPools } from './connection-pools.js';
import { createDatabase } from './db.js';
import { ProfileRegistry } from './profile-registry.js';
import { createSecretResolver } from './secret-resolver.js';
import { registerProfilesTool } from './tools/profiles.js';
import { registerQueryTool } from './tools/query.js';
import { registerExecuteTool } from './tools/execute.js';
import { registerShowTablesTool } from './tools/show_tables.js';
import { registerDescribeTableTool } from './tools/describe_table.js';
import { registerShowIndexesTool } from './tools/show_indexes.js';
import { registerExplainTool } from './tools/explain.js';
import { registerVersionTool } from './tools/version.js';

async function main() {
  const cfg = loadConfig();

  const registry = ProfileRegistry.atPath(ProfileRegistry.defaultPath());
  // 도구 스키마의 enum 은 기동 시점에 정해진다. 프로파일을 새로 추가하면 재접속이 필요하다.
  // 여닫는 것은 매 호출 파일을 다시 읽으므로 재접속이 필요 없다.
  const choices = registry.choices();

  const secrets = createSecretResolver({ source: cfg.MYSQL_SECRET_SOURCE, env: process.env });
  const pools = new ConnectionPools({ cfg, secrets });
  const db = createDatabase({ registry, pools, cfg });

  const server = new McpServer({ name: 'MySQL MCP Server', version: '1.0.0' });

  const timeoutMs = cfg.MYSQL_QUERY_TIMEOUT_MS;
  registerProfilesTool(server, db);
  registerQueryTool(server, db, { choices, timeoutMs });
  registerExecuteTool(server, db, { choices, timeoutMs });
  registerShowTablesTool(server, db, { choices });
  registerDescribeTableTool(server, db, { choices });
  registerShowIndexesTool(server, db, { choices });
  registerExplainTool(server, db, { choices });
  registerVersionTool(server, db, { choices });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    try {
      console.error(`[shutdown] received ${signal}, closing db pool...`);
      await db.close();
    } catch (e) {
      console.error('[shutdown] error while closing db:', e);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MySQL MCP Server running on stdio — 프로파일 ${choices.length}개: ${choices.map(c => c.name).join(', ')}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
