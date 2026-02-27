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
    getInboxProjectId: vi.fn().mockResolvedValue('inbox123'),
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

  it('get_tasks without projectId includes inbox tasks (inbox API returns tasks without project wrapper)', async () => {
    const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
    const mockClient = createMockClient();

    mockClient.getProjects.mockResolvedValue([{ id: 'p1', name: 'Work' }]);
    mockClient.getProjectData.mockImplementation(async (projectId: string) => {
      if (projectId === 'p1') {
        return {
          project: { id: 'p1', name: 'Work' },
          tasks: [{ id: 't1', title: 'Work task', projectId: 'p1', status: 0, tags: [], priority: 0 }],
        };
      }
      if (projectId === 'inbox123') {
        // Real TickTick API returns { tasks: [...] } without project wrapper for inbox
        return {
          tasks: [{ id: 't2', title: 'Inbox task', projectId: 'inbox123', status: 0, tags: [], priority: 0 }],
        };
      }
      return { project: { id: projectId, name: 'Unknown' }, tasks: [] };
    });
    mockClient.getInboxProjectId.mockResolvedValue('inbox123');

    registerTaskTools(server, mockClient as any);
    registerProjectTools(server, mockClient as any);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcpClient = new Client({ name: 'test-client', version: '1.0' });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({
      name: 'ticktick_get_tasks',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    const titles = parsed.tasks.map((t: any) => t.title);
    expect(titles).toContain('Work task');
    expect(titles).toContain('Inbox task');

    await mcpClient.close();
  });

  it('get_tasks with inbox projectId works even without project wrapper', async () => {
    const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
    const mockClient = createMockClient();
    // Real TickTick API returns { tasks: [...] } without project wrapper for inbox
    mockClient.getProjectData.mockResolvedValue({
      tasks: [{ id: 't1', title: 'Inbox task', projectId: 'inbox123', status: 0, tags: [], priority: 0 }],
    });

    registerTaskTools(server, mockClient as any);
    registerProjectTools(server, mockClient as any);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcpClient = new Client({ name: 'test-client', version: '1.0' });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({
      name: 'ticktick_get_tasks',
      arguments: { projectId: 'inbox123' },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].title).toBe('Inbox task');

    await mcpClient.close();
  });

  it('get_tasks with explicit projectId does NOT fetch inbox', async () => {
    const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
    const mockClient = createMockClient();
    mockClient.getProjectData.mockResolvedValue({
      project: { id: 'p1', name: 'Work' },
      tasks: [{ id: 't1', title: 'Work task', projectId: 'p1', status: 0, tags: [], priority: 0 }],
    });

    registerTaskTools(server, mockClient as any);
    registerProjectTools(server, mockClient as any);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcpClient = new Client({ name: 'test-client', version: '1.0' });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({
      name: 'ticktick_get_tasks',
      arguments: { projectId: 'p1' },
    });

    expect(result.isError).toBeFalsy();
    expect(mockClient.getInboxProjectId).not.toHaveBeenCalled();

    await mcpClient.close();
  });

  it('get_projects includes inbox even when API returns no project wrapper', async () => {
    const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
    const mockClient = createMockClient();
    mockClient.getProjects.mockResolvedValue([
      { id: 'p1', name: 'Work' },
    ]);
    // Real TickTick API returns { tasks: [...] } without project wrapper for inbox
    mockClient.getProjectData.mockResolvedValue({
      tasks: [],
    });
    mockClient.getInboxProjectId.mockResolvedValue('inbox123');

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

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    const names = parsed.map((p: any) => p.name);
    expect(names).toContain('Inbox');
    expect(names).toContain('Work');
    // Verify the synthesized inbox entry has the correct id
    const inbox = parsed.find((p: any) => p.name === 'Inbox');
    expect(inbox.id).toBe('inbox123');

    await mcpClient.close();
  });

  it('get_projects degrades gracefully if inbox discovery fails', async () => {
    const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
    const mockClient = createMockClient();
    mockClient.getProjects.mockResolvedValue([
      { id: 'p1', name: 'Work' },
    ]);
    mockClient.getInboxProjectId.mockRejectedValue(new Error('Discovery failed'));

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

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Work');

    await mcpClient.close();
  });

  it('get_tasks degrades gracefully if inbox discovery fails', async () => {
    const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
    const mockClient = createMockClient();
    mockClient.getProjects.mockResolvedValue([{ id: 'p1', name: 'Work' }]);
    mockClient.getProjectData.mockResolvedValue({
      project: { id: 'p1', name: 'Work' },
      tasks: [{ id: 't1', title: 'Work task', projectId: 'p1', status: 0, tags: [], priority: 0 }],
    });
    mockClient.getInboxProjectId.mockRejectedValue(new Error('Discovery failed'));

    registerTaskTools(server, mockClient as any);
    registerProjectTools(server, mockClient as any);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcpClient = new Client({ name: 'test-client', version: '1.0' });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({
      name: 'ticktick_get_tasks',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].title).toBe('Work task');
    expect(parsed.warnings.some((w: string) => w.toLowerCase().includes('inbox'))).toBe(true);

    await mcpClient.close();
  });
});
