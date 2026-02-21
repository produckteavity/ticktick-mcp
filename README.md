# ticktick-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects AI assistants to your [TickTick](https://ticktick.com) tasks. Create, read, update, complete, and move tasks — all through natural language.

## Prerequisites

- **Node.js** 18 or later
- A **TickTick** account
- A **TickTick OAuth app** — create one at [developer.ticktick.com](https://developer.ticktick.com/manage)
  - Set the redirect URI to `http://localhost:19876/callback`

## Installation

```bash
npx ticktick-mcp
```

Or install globally:

```bash
npm install -g ticktick-mcp
```

## Auth Setup

Before the MCP server can access your tasks, you need to authorize it once:

```bash
TICKTICK_CLIENT_ID=your_client_id \
TICKTICK_CLIENT_SECRET=your_client_secret \
npx ticktick-mcp-auth
```

This opens your browser for OAuth consent and stores tokens securely in the macOS Keychain.

## MCP Client Configuration

Add to your MCP client config (e.g. Claude Desktop, Claude Code):

```json
{
  "mcpServers": {
    "ticktick": {
      "command": "npx",
      "args": ["-y", "ticktick-mcp"],
      "env": {
        "TICKTICK_CLIENT_ID": "your_client_id"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `ticktick_create_task` | Create a new task (title required; content, project, tags, priority, dates optional) |
| `ticktick_get_task` | Get full details of a single task |
| `ticktick_get_tasks` | List tasks with optional filters (project, tag, date range, completion status) |
| `ticktick_update_task` | Modify an existing task's properties |
| `ticktick_complete_task` | Mark a task as done |
| `ticktick_move_task` | Move a task between projects |
| `ticktick_get_projects` | List all projects/lists |
| `ticktick_create_project` | Create a new project/list |

## License

[MIT](LICENSE)
