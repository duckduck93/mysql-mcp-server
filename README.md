MySQL MCP Server

Stdio-based Model Context Protocol (MCP) server that connects to MySQL-compatible databases and
exposes database tools over MCP.

Multiple databases are managed as **profiles**. The agent picks a profile on every call, and the
user controls which profiles the agent may reach by opening and closing them.

Features
- Stdio transport (no network ports exposed)
- Multiple databases via profiles, chosen per tool call
- Access gating: profiles are opened/closed by the user, optionally with an expiry
- Passwords kept out of the config — read from the OS keychain at connection time
- Tools:
  - profiles: List profiles with their open state
  - query: Execute SELECT queries with column metadata
  - execute: Run DDL/DML (INSERT/UPDATE/DELETE/CREATE/ALTER/DROP)
  - show_tables: List tables (optionally include views)
  - describe_table: Column definitions and comments for a table
  - show_indexes: Index definitions for a table
  - explain: Execution plan for a SELECT
  - version: Database version string
- Connection pooling, timeouts, SSL options

Profiles (profiles.json)

Connection details live in `profiles.json`, not in environment variables. The file is read on
**every tool call**, so edits take effect immediately — opening, closing, changing connection
details, and adding or removing profiles all apply without a restart.

A restart is only needed when the server itself is upgraded and `profiles.json` gains a field the
running build does not know about. Unknown fields are rejected on purpose, so a stray `password`
fails loudly instead of being silently ignored.

Copy `profiles.example.json` and fill it in. Restrict the permissions: `chmod 600 profiles.json`.

```json
{
  "local-dev": {
    "host": "127.0.0.1",
    "port": 3306,
    "database": "mydb",
    "user": "app",
    "enabled": true,
    "readonly": false,
    "production": false,
    "maxRows": 10000,
    "label": "dev",
    "description": "Local development database. Use this for schema checks and ad-hoc queries."
  },
  "prod": {
    "host": "db.example.internal",
    "port": 3306,
    "database": "mydb",
    "user": "readonly_user",
    "enabledUntil": null,
    "readonly": true,
    "production": true,
    "maxRows": 500,
    "timeoutMs": 15000,
    "label": "prod",
    "description": "Production database. Only when the user opens it for a specific investigation."
  }
}
```

| Field | Meaning |
|---|---|
| `host` `port` `database` `user` | Connection details. The password is not stored here |
| `enabled` | `true` keeps the profile open. Use for development databases |
| `enabledUntil` | ISO timestamp; the profile closes by itself once it passes. `null` means closed |
| `readonly` | `true` rejects the `execute` tool for this profile |
| `production` | Whether this is a production database. Required — there is no default |
| `maxRows` | Row cap. A larger `maxRows` in a tool call is clamped to this |
| `timeoutMs` | Optional query timeout cap for this profile |
| `label` | Short name for the menu bar (optional) |
| `description` | The only basis the agent has for picking this profile. Write *when* to use it |

Rules enforced at startup:
- Exactly one of `enabled` / `enabledUntil` must be present.
- A profile with `production: true` cannot use `enabled` — production may only be opened with an
  expiry, so that forgetting to close it is not possible.
- Unknown fields are rejected, so a stray `password` field fails loudly instead of being ignored.

Environment Variables

None are required. The server starts with no environment at all.

- MYSQL_PROFILES: Path to the profiles file. Defaults to `profiles.json` next to the package
  (resolved from the module path, never from the current working directory)
- MYSQL_SECRET_SOURCE: keychain | env (default: keychain)
  - `keychain` (macOS only): read from the login keychain at connection time
  - `env`: read from MYSQL_PASSWORD. For platforms with no secure store implementation yet
    (Windows, Linux). There is no fallback between sources — the declared one is the only one
    used, and a failed lookup fails the call
- MYSQL_PASSWORD: Password. Only read when MYSQL_SECRET_SOURCE=env. One value for all profiles
- MYSQL_SSL: off | required | verify_ca (default: off)
- MYSQL_SSL_CA_BASE64: Base64-encoded CA cert
- MYSQL_SSL_CERT_BASE64: Base64-encoded client cert (optional)
- MYSQL_SSL_KEY_BASE64: Base64-encoded client key (optional)
- MYSQL_TIMEZONE: Connection timezone (e.g., Z, local, +00:00)
- MYSQL_CHARSET: Character set (e.g., utf8mb4)
- MYSQL_CONNECT_TIMEOUT_MS: Default 10000
- MYSQL_QUERY_TIMEOUT_MS: Default 60000 (fallback when a profile has no `timeoutMs`)
- MYSQL_POOL_MIN: Default 0 (reserved, not used by mysql2)
- MYSQL_POOL_MAX: Default 10
- MYSQL_HOST_RESOLVE / MYSQL_HOST_DOCKER: Remap a loopback `host` to the container host
- LOG_LEVEL: silent | error | warn | info | debug (not fully used yet)

Registering passwords in the keychain (macOS)

Run `npm run keychain` to see which profiles still need an entry and get the exact command for
each. It only reads item attributes, never the secret, so it never triggers an approval prompt.
To register manually:

```
security add-generic-password -U -s "mysql-mcp/<profile>" -a "<user>" -w
```

Leave the value after `-w` empty — `security` then prompts for it, so the password never lands in
shell history.

**Register every profile with `-T ""`.** Without it the item is readable by anything that can run
`security` — including an agent with shell access — and no approval dialog appears. With it, each
read requires approval. The password is read once when the connection pool is created, so in
practice the dialog appears once per profile per server session, not per query.

In the approval dialog choose "Allow", not "Always Allow" — the latter permanently trusts
`/usr/bin/security` for that item and removes the protection.

The exception is a profile used by unattended runs (a scheduler, CI). Nobody is there to approve,
so the read blocks and times out. Drop `-T ""` for those, knowing what it costs.

`-T ""` cannot be added to an existing item in place; delete it and register again.

Build & Run (local)
1) Install dependencies and build
```
npm ci
npm run build
```

2) Create `profiles.json` (see above), then run over stdio
```
node dist/index.js
```

On platforms without a keychain implementation:
```
MYSQL_SECRET_SOURCE=env MYSQL_PASSWORD=secret node dist/index.js
```

3) Optional: a local MySQL for the end-to-end tests
```
docker compose -f docker-compose.test.yml up -d
```
The e2e tests skip themselves when no database is reachable.

MCP Tools

Every tool except `profiles` takes a required `profile` argument. There is no default — the agent
must choose one, using the `description` of each profile as the basis.

The argument is a plain string, not an enum. The tool schema is exchanged once per session, so an
enum would freeze the list and force a restart whenever a profile is added. The name is validated
by the registry at call time instead, and an unknown name fails with the list of valid ones. The
candidate list carried in the argument description is from startup — call `profiles` for the
current one.

- profiles
  - input: {}
  - output: { profiles: { name; description; open: boolean; readonly: boolean; production: boolean; maxRows: number; expiresAt?: string }[] }
- query
  - input: { profile: string; sql: string; params?: any[]; maxRows?: number; timeoutMs?: number }
  - output: { rows: any[]; columns: {name: string; type: string}[]; truncated: boolean; elapsedMs: number }
- execute
  - input: { profile: string; sql: string; params?: any[]; timeoutMs?: number }
  - output: { affectedRows: number; insertId?: number; warningStatus?: number; elapsedMs: number }
- show_tables
  - input: { profile: string; includeViews?: boolean }
  - output: { tables: { name: string; type: 'BASE TABLE' | 'VIEW' }[] }
- describe_table
  - input: { profile: string; table: string }
  - output: { table: string; columns: { name; type; nullable; default?; key?; extra?; comment? }[]; tableComment?: string }
- show_indexes
  - input: { profile: string; table: string }
  - output: { table: string; indexes: { name; columns: string[]; unique: boolean; visible?; comment?; type? }[] }
- explain
  - input: { profile: string; sql: string; params?: any[] }
  - output: { plan: any[] }
- version
  - input: { profile: string }
  - output: { version: string }

Errors the agent may receive
- Unknown profile — the message lists the valid profile names.
- Profile is closed — the message states that the user must open it, and that the agent should ask
  rather than switching to another profile.
- Profile is open but unreachable — connection or authentication failed. The message carries the
  profile's `description` so the alternative is visible, and asks the agent to check with the user.
  Query errors such as SQL syntax problems are not wrapped and pass through unchanged.

Menu bar control (macOS, optional)

`swiftbar/mysql-mcp.10s.sh` is a [SwiftBar](https://github.com/swiftbar/SwiftBar) plugin that
shows each profile's state and opens/closes them from the menu bar. Symlink it into the SwiftBar
plugin folder. Closing is one click; opening a gated profile takes a duration choice, so it cannot
happen by accident.

Notes
- Row caps and query timeouts are per profile; a tool call cannot exceed them.
- For EXPLAIN, the raw plan rows are returned to preserve all fields.
- `profiles.json` and diagnostic scripts are gitignored. Keep credentials out of the repository.
