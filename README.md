MySQL MCP Server

Stdio-based Model Context Protocol (MCP) server that connects to a MySQL-compatible database and exposes database tools over MCP.

Features
- Stdio transport (no network ports exposed)
- Tools:
  - query: Execute SELECT queries with column metadata
  - execute: Run DDL/DML (INSERT/UPDATE/DELETE/CREATE/ALTER/DROP)
  - show_tables: List tables (optionally include views)
  - describe_table: Column definitions and comments for a table
  - show_indexes: Index definitions for a table
  - explain: Execution plan for a SELECT
  - version: Database version string
- Connection pooling, timeouts, SSL options
- Containerized via Docker

Environment Variables
Required:
- MYSQL_HOST: MySQL host
- MYSQL_PORT: MySQL port (default: 3306)
- MYSQL_USER: Username
- MYSQL_PASSWORD: Password
- MYSQL_DATABASE: Database name (single DB fixed)

Optional:
- MYSQL_SSL: off | required | verify_ca (default: off)
- MYSQL_SSL_CA_BASE64: Base64-encoded CA cert
- MYSQL_SSL_CERT_BASE64: Base64-encoded client cert (optional)
- MYSQL_SSL_KEY_BASE64: Base64-encoded client key (optional)
- MYSQL_TIMEZONE: Connection timezone (e.g., Z, local, +00:00)
- MYSQL_CHARSET: Character set (e.g., utf8mb4)
- MYSQL_CONNECT_TIMEOUT_MS: Default 10000
- MYSQL_QUERY_TIMEOUT_MS: Default 60000
- MYSQL_POOL_MIN: Default 0 (reserved, not used by mysql2)
- MYSQL_POOL_MAX: Default 10
- MAX_ROWS: Default 10000 (result truncation threshold)
- LOG_LEVEL: silent | error | warn | info | debug (not fully used yet)

Build & Run (local)
1) Install dependencies and build
```
npm ci
npm run build
```

2) Run (stdio)
```
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=root \
MYSQL_PASSWORD=secret \
MYSQL_DATABASE=mydb \
node dist/index.js
```

Docker
Build image:
```
docker build -t mysql-mcp-server .
```

Run container (stdio):
Note: Because the server uses stdio, it is intended to be launched by an MCP client that reads/writes the container stdin/stdout. Example below shows manual run (interactive):
```
docker run --rm -it \
  -e MYSQL_HOST=host.docker.internal \
  -e MYSQL_PORT=3306 \
  -e MYSQL_USER=root \
  -e MYSQL_PASSWORD=secret \
  -e MYSQL_DATABASE=mydb \
  mysql-mcp-server
```

MCP Tools
- query
  - input: { sql: string; params?: any[]; maxRows?: number; timeoutMs?: number }
  - output: { rows: any[]; columns: {name: string; type: string}[]; truncated: boolean; elapsedMs: number }
- execute
  - input: { sql: string; params?: any[]; timeoutMs?: number }
  - output: { affectedRows: number; insertId?: number; warningStatus?: number; elapsedMs: number }
- show_tables
  - input: { includeViews?: boolean }
  - output: { tables: { name: string; type: 'BASE TABLE' | 'VIEW' }[] }
- describe_table
  - input: { table: string }
  - output: { table: string; columns: { name; type; nullable; default?; key?; extra?; comment? }[]; tableComment?: string }
- show_indexes
  - input: { table: string }
  - output: { table: string; indexes: { name; columns: string[]; unique: boolean; visible?; comment?; type? }[] }
- explain
  - input: { sql: string; params?: any[] }
  - output: { plan: any[] }
- version
  - input: {}
  - output: { version: string }

Notes
- Single database fixed per process (from MYSQL_DATABASE). Switching DB via tools is not supported.
- Large result sets may be truncated to MAX_ROWS with truncated=true.
- For EXPLAIN, the raw plan rows are returned to preserve all fields.
