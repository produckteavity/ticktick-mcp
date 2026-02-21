import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTaskTools } from '../../src/tools/tasks.js';

/**
 * Helper: creates a mock TickTickClient with configurable getProjectData / getProjects.
 */
function createMockClient(overrides: Record<string, any> = {}) {
  return {
    getProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    getProjectData: vi.fn().mockResolvedValue({ project: { id: 'p1', name: 'Test' }, tasks: [] }),
    createTask: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    completeTask: vi.fn(),
    ...overrides,
  };
}

/** Helper: valid task object that passes TickTickTask validation */
function validTask(id: string, projectId = 'p1') {
  return {
    id,
    title: `Task ${id}`,
    content: '',
    projectId,
    status: 0,
    tags: [],
    priority: 0,
  };
}

/** Helper: task object that will FAIL TickTickTask validation (missing required fields) */
function invalidTask() {
  return {
    // missing id, projectId, status — all required by TickTickTask
    title: 'Bad task',
  };
}

/**
 * Helper: set up an MCP server + client pair with the given mock client,
 * call ticktick_get_tasks with the given args, and return the parsed result.
 */
async function callGetTasks(
  mockClient: ReturnType<typeof createMockClient>,
  args: Record<string, unknown> = {},
) {
  const server = new McpServer({ name: 'ticktick-mcp', version: '0.1.0' });
  registerTaskTools(server, mockClient as any);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const mcpClient = new Client({ name: 'test-client', version: '1.0' });
  await mcpClient.connect(clientTransport);

  const result = await mcpClient.callTool({
    name: 'ticktick_get_tasks',
    arguments: args,
  });

  await mcpClient.close();
  return result;
}

/** Parse the JSON text from an MCP tool result content array */
function parseResultText(result: any): any {
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  return JSON.parse(text);
}

describe('ticktick_get_tasks — warnings for data loss (issues #3 and #4)', () => {

  describe('Issue #3: single-project query with unparseable project data', () => {
    it('returns an error when project data fails to parse for a single-project query', async () => {
      const mockClient = createMockClient({
        // Return something that is not valid project data at all (e.g. missing project field)
        getProjectData: vi.fn().mockResolvedValue({ garbage: true }),
      });

      const result = await callGetTasks(mockClient, { projectId: 'p1' });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('Failed to parse project data');
    });
  });

  describe('Issue #3: multi-project query with one project failing parse', () => {
    it('returns tasks from valid projects and includes a warning about the failed project', async () => {
      const mockClient = createMockClient({
        getProjects: vi.fn().mockResolvedValue([
          { id: 'p1' },
          { id: 'p2' },
        ]),
        getProjectData: vi.fn().mockImplementation((projectId: string) => {
          if (projectId === 'p1') {
            return Promise.resolve({
              project: { id: 'p1', name: 'Good Project' },
              tasks: [validTask('t1', 'p1'), validTask('t2', 'p1')],
            });
          }
          // p2 returns invalid project data (missing project field)
          return Promise.resolve({ garbage: true });
        }),
      });

      const result = await callGetTasks(mockClient);

      expect(result.isError).toBeFalsy();
      const data = parseResultText(result);
      expect(data.tasks).toHaveLength(2);
      expect(data.warnings).toBeDefined();
      expect(data.warnings.length).toBeGreaterThan(0);
      expect(data.warnings[0]).toMatch(/1 project.*could not be parsed/i);
    });
  });

  describe('Issue #4: tasks that fail individual validation', () => {
    it('returns valid tasks and a warning with count of dropped tasks', async () => {
      const mockClient = createMockClient({
        getProjectData: vi.fn().mockResolvedValue({
          project: { id: 'p1', name: 'My Project' },
          tasks: [
            validTask('t1', 'p1'),
            validTask('t2', 'p1'),
            invalidTask(),
            invalidTask(),
            invalidTask(),
          ],
        }),
      });

      const result = await callGetTasks(mockClient, { projectId: 'p1' });

      expect(result.isError).toBeFalsy();
      const data = parseResultText(result);
      expect(data.tasks).toHaveLength(2);
      expect(data.warnings).toBeDefined();
      expect(data.warnings.length).toBeGreaterThan(0);
      expect(data.warnings[0]).toMatch(/3 task.*could not be parsed/i);
    });
  });

  describe('all tasks valid — no warnings', () => {
    it('returns tasks without any warnings when everything parses fine', async () => {
      const mockClient = createMockClient({
        getProjectData: vi.fn().mockResolvedValue({
          project: { id: 'p1', name: 'My Project' },
          tasks: [validTask('t1', 'p1'), validTask('t2', 'p1')],
        }),
      });

      const result = await callGetTasks(mockClient, { projectId: 'p1' });

      expect(result.isError).toBeFalsy();
      const data = parseResultText(result);
      expect(data.tasks).toHaveLength(2);
      expect(data.warnings).toEqual([]);
    });
  });

  describe('mix of valid and invalid tasks across multiple projects', () => {
    it('returns valid tasks and warning with count of dropped tasks', async () => {
      const mockClient = createMockClient({
        getProjects: vi.fn().mockResolvedValue([
          { id: 'p1' },
          { id: 'p2' },
        ]),
        getProjectData: vi.fn().mockImplementation((projectId: string) => {
          if (projectId === 'p1') {
            return Promise.resolve({
              project: { id: 'p1', name: 'Project A' },
              tasks: [validTask('t1', 'p1'), invalidTask()],
            });
          }
          return Promise.resolve({
            project: { id: 'p2', name: 'Project B' },
            tasks: [validTask('t2', 'p2'), invalidTask(), invalidTask()],
          });
        }),
      });

      const result = await callGetTasks(mockClient);

      expect(result.isError).toBeFalsy();
      const data = parseResultText(result);
      expect(data.tasks).toHaveLength(2);
      expect(data.warnings).toBeDefined();
      expect(data.warnings[0]).toMatch(/3 task.*could not be parsed/i);
    });
  });

  describe('multi-project: all projects fail parsing', () => {
    it('returns empty tasks and a warning about all failed projects', async () => {
      const mockClient = createMockClient({
        getProjects: vi.fn().mockResolvedValue([
          { id: 'p1' },
          { id: 'p2' },
        ]),
        getProjectData: vi.fn().mockResolvedValue({ garbage: true }),
      });

      const result = await callGetTasks(mockClient);

      expect(result.isError).toBeFalsy();
      const data = parseResultText(result);
      expect(data.tasks).toHaveLength(0);
      expect(data.warnings).toBeDefined();
      expect(data.warnings[0]).toMatch(/2 project.*could not be parsed/i);
    });
  });

  describe('single project: cascading failure from one bad task no longer drops all', () => {
    it('recovers valid tasks even when one task in the array would have failed old schema', async () => {
      // This is the core issue #3 scenario: one bad task in the array
      // used to cause TickTickProjectData.safeParse to fail entirely,
      // dropping ALL tasks for the project silently.
      const mockClient = createMockClient({
        getProjectData: vi.fn().mockResolvedValue({
          project: { id: 'p1', name: 'My Project' },
          tasks: [
            validTask('t1', 'p1'),
            { title: 'no id or status' }, // invalid
            validTask('t3', 'p1'),
          ],
        }),
      });

      const result = await callGetTasks(mockClient, { projectId: 'p1' });

      expect(result.isError).toBeFalsy();
      const data = parseResultText(result);
      // Should recover the 2 valid tasks, not drop all 3
      expect(data.tasks).toHaveLength(2);
      expect(data.tasks[0].id).toBe('t1');
      expect(data.tasks[1].id).toBe('t3');
      expect(data.warnings[0]).toMatch(/1 task.*could not be parsed/i);
    });
  });
});
