# ticktick-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects AI assistants to your [TickTick](https://ticktick.com) tasks. Create, read, update, complete, and move tasks — all through natural language.

> **Platform:** macOS only. Token storage uses the macOS Keychain. Linux and Windows support is planned.

## How It Works

This server implements the [Model Context Protocol](https://modelcontextprotocol.io), allowing AI assistants like Claude to manage your TickTick tasks through natural conversation. Once configured, you can say things like "create a task to buy groceries due Friday" or "show me all my tasks tagged @work."

## Prerequisites

- **Node.js** 18 or later
- A **TickTick** account
- A **TickTick OAuth app**:
  1. Go to [developer.ticktick.com/manage](https://developer.ticktick.com/manage)
  2. Create a new app
  3. Set the **Redirect URI** to `http://localhost:19876/callback`
  4. Copy your **Client ID** and **Client Secret**

## Setup

### 1. Authorize

Run once to connect the server to your TickTick account:

```bash
TICKTICK_CLIENT_ID=your_client_id \
TICKTICK_CLIENT_SECRET=your_client_secret \
npx ticktick-mcp-server-auth
```

This opens your browser for OAuth consent and stores tokens securely in the macOS Keychain.

### 2. Configure Your MCP Client

Add to your MCP client config (e.g. Claude Desktop, Claude Code):

```json
{
  "mcpServers": {
    "ticktick": {
      "command": "npx",
      "args": ["-y", "ticktick-mcp-server"],
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
| `ticktick_create_task` | Create a new task (title required; content, project, tags, priority, dates, recurrence optional) |
| `ticktick_get_task` | Get full details of a single task |
| `ticktick_get_tasks` | List tasks with optional filters (project, tag, date range, completion status) |
| `ticktick_update_task` | Modify an existing task's properties (including recurrence) |
| `ticktick_complete_task` | Mark a task as done |
| `ticktick_move_task` | Move a task between projects |
| `ticktick_get_projects` | List all projects/lists |
| `ticktick_create_project` | Create a new project/list |

## Example Prompts

Once configured, try these with your AI assistant:

- "Show me my tasks due this week"
- "Create a task called 'Review PR #42' in my Work project with high priority"
- "Move the grocery list task to my Personal project"
- "What projects do I have in TickTick?"
- "Create a recurring task to pay rent on the 1st of every month"

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Authentication failed` | Re-run the auth command above to refresh tokens |
| `Rate limited` | Wait the indicated number of seconds and retry |
| Auth command hangs | Ensure port 19876 is not in use by another process |
| `TICKTICK_CLIENT_ID` not set | Ensure the env var is set in your MCP client config |

## Limitations

- **macOS only** — uses the macOS Keychain for token storage
- **Moving a task** creates a copy in the target project and completes the original; task IDs change
- **Listing all tasks** (without a project filter) fetches each project sequentially
- **Subtasks and attachments** are not currently supported

## License

[MIT](LICENSE)
