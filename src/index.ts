#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Keychain } from './keychain.js';
import { TokenManager } from './auth.js';
import { TickTickClient } from './ticktick-client.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerProjectTools } from './tools/projects.js';

function log(level: string, msg: string) {
  console.error(JSON.stringify({ level, msg, ts: new Date().toISOString() }));
}

const clientId = process.env.TICKTICK_CLIENT_ID;
if (!clientId) {
  log('error', 'TICKTICK_CLIENT_ID environment variable is required');
  process.exit(1);
}

const keychain = new Keychain('ticktick-mcp');
const tokenManager = new TokenManager(keychain, clientId);
const ticktickClient = new TickTickClient(tokenManager);

const server = new McpServer({
  name: 'ticktick-mcp',
  version: '0.1.0',
});

registerTaskTools(server, ticktickClient);
registerProjectTools(server, ticktickClient);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'TickTick MCP server started');
}

main().catch((err) => {
  log('error', `Failed to start: ${err.message}`);
  process.exit(1);
});
