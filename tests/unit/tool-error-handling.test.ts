import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTaskTools } from '../../src/tools/tasks.js';
import { registerProjectTools } from '../../src/tools/projects.js';
import { TickTickApiError, TickTickRateLimitError } from '../../src/ticktick-client.js';
import { AuthError } from '../../src/auth.js';
import { ZodError } from 'zod';

function createMockClient() {
  return {
    getProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue({ id: 'p1', name: 'Test' }),
    getProjectData: vi.fn().mockResolvedValue({ project: { id: 'p1', name: 'Test' }, tasks: [] }),
    createTask: vi.fn().mockResolvedValue({ id: 't-new', title: 'Created', projectId: 'p2', status: 0 }),
    getTask: vi.fn().mockResolvedValue({
      id: 't1', title: 'Original', content: 'desc', projectId: 'p1',
      status: 0, tags: ['work'], priority: 3, dueDate: '2026-03-01T00:00:00+0000',
      startDate: '2026-02-20T00:00:00+0000', repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=1',
    }),
    updateTask: vi.fn().mockResolvedValue({ id: 't1', title: 'Updated' }),
    completeTask: vi.fn().mockResolvedValue(null),
  };
}

async function setupServer(mockClient: ReturnType<typeof createMockClient>) {
  const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
  registerTaskTools(server, mockClient as any);
  registerProjectTools(server, mockClient as any);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const mcpClient = new Client({ name: 'test-client', version: '1.0' });
  await mcpClient.connect(clientTransport);

  return { mcpClient, server };
}

function getResultText(result: any): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

// ============================================================
// Issue #5: move_task safety
// ============================================================
describe('move_task safety (Issue #5)', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let mcpClient: Client;

  beforeEach(async () => {
    mockClient = createMockClient();
  });

  afterEach(async () => {
    if (mcpClient) await mcpClient.close();
  });

  it('returns isError when getTask returns null/undefined', async () => {
    mockClient.getTask.mockResolvedValue(null);
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_move_task',
      arguments: { sourceProjectId: 'p1', taskId: 't1', targetProjectId: 'p2' },
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/task not found|failed to validate/i);
    // Original should NOT be completed since we could not read it
    expect(mockClient.completeTask).not.toHaveBeenCalled();
  });

  it('returns isError when getTask returns data that fails TickTickTask validation', async () => {
    // Missing required fields (no id, no projectId, no status)
    mockClient.getTask.mockResolvedValue({ foo: 'bar' });
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_move_task',
      arguments: { sourceProjectId: 'p1', taskId: 't1', targetProjectId: 'p2' },
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/failed to validate|invalid/i);
    expect(mockClient.completeTask).not.toHaveBeenCalled();
  });

  it('completes the original task after createTask succeeds', async () => {
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_move_task',
      arguments: { sourceProjectId: 'p1', taskId: 't1', targetProjectId: 'p2' },
    });

    expect(result.isError).toBeFalsy();
    // createTask was called first, then completeTask
    expect(mockClient.createTask).toHaveBeenCalledTimes(1);
    expect(mockClient.completeTask).toHaveBeenCalledWith('p1', 't1');
  });

  it('does NOT complete the original task when createTask throws', async () => {
    mockClient.createTask.mockRejectedValue(new TickTickApiError(500, 'Internal Server Error'));
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_move_task',
      arguments: { sourceProjectId: 'p1', taskId: 't1', targetProjectId: 'p2' },
    });

    expect(result.isError).toBe(true);
    // The original task must be preserved
    expect(mockClient.completeTask).not.toHaveBeenCalled();
  });

  it('copies the repeatFlag field during move', async () => {
    ({ mcpClient } = await setupServer(mockClient));

    await mcpClient.callTool({
      name: 'ticktick_move_task',
      arguments: { sourceProjectId: 'p1', taskId: 't1', targetProjectId: 'p2' },
    });

    expect(mockClient.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=1',
      }),
    );
  });
});

// ============================================================
// Issue #7: error differentiation with formatToolError
// ============================================================
describe('error differentiation (Issue #7)', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let mcpClient: Client;

  beforeEach(async () => {
    mockClient = createMockClient();
  });

  afterEach(async () => {
    if (mcpClient) await mcpClient.close();
  });

  it('TickTickRateLimitError includes retry time in message', async () => {
    mockClient.createTask.mockRejectedValue(new TickTickRateLimitError(30));
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_create_task',
      arguments: { title: 'Test task' },
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/rate limited/i);
    expect(text).toContain('30');
  });

  it('AuthError includes re-auth guidance', async () => {
    mockClient.getProjects.mockRejectedValue(new AuthError('Token expired'));
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_get_projects',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/authentication failed/i);
    expect(text).toMatch(/ticktick-mcp-auth/i);
  });

  it('TickTickApiError includes status code and message', async () => {
    mockClient.getTask.mockRejectedValue(new TickTickApiError(404, 'Not Found'));
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_get_task',
      arguments: { projectId: 'p1', taskId: 'nonexistent' },
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/TickTick API error/i);
    expect(text).toContain('404');
  });

  it('AbortError / timeout results in timeout message', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockClient.updateTask.mockRejectedValue(abortError);
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_update_task',
      arguments: { taskId: 't1', title: 'Updated' },
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/timed out|try again/i);
  });

  it('generic Error includes the error message', async () => {
    mockClient.completeTask.mockRejectedValue(new Error('Something broke'));
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_complete_task',
      arguments: { projectId: 'p1', taskId: 't1' },
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/unexpected error/i);
    expect(text).toContain('Something broke');
  });

  it('project tools also differentiate errors (TickTickRateLimitError)', async () => {
    mockClient.createProject.mockRejectedValue(new TickTickRateLimitError(45));
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_create_project',
      arguments: { name: 'New Project' },
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/rate limited/i);
    expect(text).toContain('45');
  });

  it('project tools differentiate AuthError', async () => {
    mockClient.getProjects.mockRejectedValue(new AuthError('Not authenticated'));
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_get_projects',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/authentication failed/i);
    expect(text).toMatch(/ticktick-mcp-auth/i);
  });

  it('move_task handler also uses formatToolError for TickTickApiError', async () => {
    mockClient.getTask.mockRejectedValue(new TickTickApiError(403, 'Forbidden'));
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_move_task',
      arguments: { sourceProjectId: 'p1', taskId: 't1', targetProjectId: 'p2' },
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/TickTick API error/i);
    expect(text).toContain('403');
  });

  it('get_tasks handler uses formatToolError', async () => {
    mockClient.getProjectData.mockRejectedValue(new TickTickRateLimitError(10));
    ({ mcpClient } = await setupServer(mockClient));

    const result = await mcpClient.callTool({
      name: 'ticktick_get_tasks',
      arguments: { projectId: 'p1' },
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result);
    expect(text).toMatch(/rate limited/i);
    expect(text).toContain('10');
  });
});
