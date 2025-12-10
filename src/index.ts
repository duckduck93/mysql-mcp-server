#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { registerQueryTool } from './tools/query.js';
import { registerExecuteTool } from './tools/execute.js';
import { registerShowTablesTool } from './tools/show_tables.js';
import { registerDescribeTableTool } from './tools/describe_table.js';
import { registerShowIndexesTool } from './tools/show_indexes.js';
import { registerExplainTool } from './tools/explain.js';
import { registerVersionTool } from './tools/version.js';

async function main() {
  const cfg = loadConfig();

  const server = new McpServer({ name: 'MySQL MCP Server', version: '1.0.0' });
  const db = createDatabase(cfg);

  // Register tools
  registerQueryTool(server, db, { maxRows: cfg.MAX_ROWS, timeoutMs: cfg.MYSQL_QUERY_TIMEOUT_MS });
  registerExecuteTool(server, db, { timeoutMs: cfg.MYSQL_QUERY_TIMEOUT_MS });
  registerShowTablesTool(server, db);
  registerDescribeTableTool(server, db);
  registerShowIndexesTool(server, db);
  registerExplainTool(server, db);
  registerVersionTool(server, db);

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
  console.error('MySQL MCP Server running on stdio');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
