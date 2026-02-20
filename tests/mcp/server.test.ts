import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTaskTools } from '../../src/tools/tasks.js';
import { registerProjectTools } from '../../src/tools/projects.js';

function createMockClient() {
  return {
    getProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({ id: 'p1', name: 'Test' }),
    getProjectData: vi.fn().mockResolvedValue({ project: { id: 'p1' }, tasks: [] }),
    createTask: vi.fn().mockResolvedValue({ id: 't1', title: 'Test' }),
    getTask: vi.fn().mockResolvedValue({ id: 't1', title: 'Test', projectId: 'p1', status: 0 }),
    updateTask: vi.fn().mockResolvedValue({ id: 't1', title: 'Updated' }),
    completeTask: vi.fn().mockResolvedValue(null),
  };
}

describe('MCP Server', () => {
  it('registers all expected tools', async () => {
    const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
    const mockClient = createMockClient();

    registerTaskTools(server, mockClient as any);
    registerProjectTools(server, mockClient as any);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const mcpClient = new Client({ name: 'test-client', version: '1.0' });
    await mcpClient.connect(clientTransport);

    const { tools } = await mcpClient.listTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('ticktick_create_task');
    expect(toolNames).toContain('ticktick_get_task');
    expect(toolNames).toContain('ticktick_get_tasks');
    expect(toolNames).toContain('ticktick_update_task');
    expect(toolNames).toContain('ticktick_complete_task');
    expect(toolNames).toContain('ticktick_move_task');
    expect(toolNames).toContain('ticktick_get_projects');
    expect(toolNames).toContain('ticktick_create_project');

    await mcpClient.close();
  });

  it('create_task tool returns task data', async () => {
    const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
    const mockClient = createMockClient();
    mockClient.createTask.mockResolvedValue({
      id: 't1', title: 'Buy milk', projectId: 'inbox', status: 0,
    });

    registerTaskTools(server, mockClient as any);
    registerProjectTools(server, mockClient as any);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const mcpClient = new Client({ name: 'test-client', version: '1.0' });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({
      name: 'ticktick_create_task',
      arguments: { title: 'Buy milk' },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Buy milk');

    await mcpClient.close();
  });

  it('returns isError on API failure', async () => {
    const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
    const mockClient = createMockClient();
    mockClient.getProjects.mockRejectedValue(new Error('Network error'));

    registerTaskTools(server, mockClient as any);
    registerProjectTools(server, mockClient as any);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const mcpClient = new Client({ name: 'test-client', version: '1.0' });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({
      name: 'ticktick_get_projects',
      arguments: {},
    });

    expect(result.isError).toBe(true);

    await mcpClient.close();
  });
});
