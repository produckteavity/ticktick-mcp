# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Model Context Protocol (MCP) server that exposes TickTick task management as MCP tools. Built with TypeScript, uses the TickTick Open API, and communicates over stdio transport.

## Commands

```bash
npm run build          # TypeScript compilation (tsc) → dist/
npm run test           # Run all tests (vitest run)
npm run test:unit      # Unit tests only (tests/unit/)
npm run test:mcp       # MCP server integration tests (tests/mcp/)
npm run test:watch     # Vitest in watch mode

# Run a single test file
npx vitest run tests/unit/filtering.test.ts

# Integration tests require real credentials and prior auth
TICKTICK_CLIENT_ID=xxx npx vitest run tests/integration/spike-tags.test.ts
```

## Architecture

**Entry point**: `src/index.ts` — Creates the MCP server, wires up dependencies (Keychain → TokenManager → TickTickClient), registers tools, connects stdio transport.

**Layered design** (each layer only depends on the one below):

1. **Tool registration** (`src/tools/tasks.ts`, `src/tools/projects.ts`) — Registers MCP tools on `McpServer`. Each tool validates input with Zod schemas, delegates to `TickTickClient`, and returns JSON-stringified success/error responses. Tool handlers catch all errors and return `isError: true` rather than throwing.

2. **API client** (`src/ticktick-client.ts`) — HTTP wrapper around TickTick Open API (`api.ticktick.com/open/v1`). Handles auth headers, 401 retry (one retry with token refresh), 429 rate limiting, and 10s timeout. Constructor accepts injectable `fetch` for testing.

3. **Auth** (`src/auth.ts`) — `TokenManager` manages OAuth token lifecycle. Reads tokens from keychain, checks expiry with 60s margin, refreshes automatically. Depends on a `KeychainLike` interface (not concrete `Keychain`).

4. **Keychain** (`src/keychain.ts`) — macOS-only credential storage via `security` CLI. Stores under service name `ticktick-mcp`.

**Supporting modules**:
- `src/types.ts` — All Zod schemas: input validation schemas (tool params) and output validation schemas (API responses). Types are inferred from schemas. Response schemas use `.strip()` to drop unknown fields.
- `src/filtering.ts` — Client-side task filtering (tag, date range, completion status) since the TickTick API returns all tasks per project.
- `src/cache.ts` — Generic `TtlCache<T>` (not yet wired into the client).
- `src/auth-cli.ts` — Standalone OAuth CLI that opens browser, receives callback on `localhost:19876`, exchanges code for tokens, stores in keychain.

## Key Design Patterns

- **Dependency injection for testability**: `TickTickClient` accepts `fetchFn`, `TokenManager` accepts `KeychainLike` interface. Tests use mock implementations.
- **Zod for both input and output validation**: Tool inputs validated at the tool layer, API responses validated/stripped before returning to consumers.
- **MCP tool responses**: Always `{ content: [{ type: 'text', text: ... }] }` with optional `isError: true`. Never throw from tool handlers.
- **Move = copy + complete**: `ticktick_move_task` creates task in target project then completes in source (TickTick API has no native move).
- **`get_tasks` fetches all projects**: When no `projectId` is specified, iterates all projects sequentially to aggregate tasks, then filters client-side.

## Environment Variables

- `TICKTICK_CLIENT_ID` (required at runtime) — OAuth client ID
- `TICKTICK_CLIENT_SECRET` (required for auth CLI only) — OAuth client secret

## Test Structure

- `tests/unit/` — Pure unit tests with mocks, no network calls
- `tests/mcp/` — MCP protocol-level tests using `InMemoryTransport` and mock client
- `tests/integration/` — Real API calls, skipped unless `TICKTICK_CLIENT_ID` is set
- Vitest with `globals: true` — no need to import `describe`/`it`/`expect` (though files currently do)
