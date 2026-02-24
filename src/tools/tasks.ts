import { z, ZodError } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TickTickClient } from '../ticktick-client.js';
import { TickTickApiError, TickTickRateLimitError } from '../ticktick-client.js';
import { AuthError } from '../auth.js';
import { CreateTaskInput, GetTaskInput, GetTasksInput, UpdateTaskInput, CompleteTaskInput, MoveTaskInput, TickTickTask, TickTickProjectData, TickTickProjectDataRaw } from '../types.js';
import { filterTasks } from '../filtering.js';

function success(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function error(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

export function formatToolError(e: unknown): string {
  if (e instanceof TickTickRateLimitError) {
    return `Rate limited. Try again in ${e.retryAfter} seconds.`;
  }
  if (e instanceof AuthError) {
    return `Authentication failed. Run \`ticktick-mcp-auth\` to re-authorize.`;
  }
  if (e instanceof TickTickApiError) {
    return e.message;
  }
  if (e instanceof ZodError) {
    const firstIssue = e.issues[0];
    return `Invalid input: ${firstIssue?.message ?? 'validation failed'}`;
  }
  if (e instanceof DOMException && e.name === 'AbortError') {
    return 'Request timed out. Try again.';
  }
  if (e instanceof Error && e.name === 'TimeoutError') {
    return 'Request timed out. Try again.';
  }
  if (e instanceof Error) {
    return `Unexpected error: ${e.message}`;
  }
  return `Unexpected error: ${String(e)}`;
}

export function registerTaskTools(server: McpServer, client: TickTickClient): void {
  server.tool(
    'ticktick_create_task',
    'Use this to create a new task in TickTick. Required: title. Optional: content, projectId (omit for Inbox), tags (array of strings), priority (0=none, 1=low, 3=medium, 5=high), dueDate, startDate (ISO 8601 strings), repeatFlag (iCalendar RRULE string).',
    {
      title: z.string().min(1).max(500).describe('Task title'),
      content: z.string().max(5000).optional().describe('Task description/notes'),
      projectId: z.string().optional().describe('Project/list ID. Omit to add to Inbox'),
      tags: z.array(z.string()).optional().describe('Tags (e.g. ["@call", "@computer"])'),
      priority: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5)]).optional().describe('Priority: 0=none, 1=low, 3=medium, 5=high'),
      dueDate: z.string().optional().describe('Due date in ISO 8601 format'),
      startDate: z.string().optional().describe('Start date in ISO 8601 format'),
      repeatFlag: z.string().optional().describe("iCalendar RRULE string for recurring tasks (e.g., 'RRULE:FREQ=MONTHLY;INTERVAL=1')"),
    },
    async ({ title, content, projectId, tags, priority, dueDate, startDate, repeatFlag }) => {
      try {
        const input = CreateTaskInput.parse({ title, content, projectId, tags, priority, dueDate, startDate, repeatFlag });
        const task = await client.createTask(input);
        return success(task);
      } catch (e: unknown) {
        return error(`Failed to create task: ${formatToolError(e)}`);
      }
    },
  );

  server.tool(
    'ticktick_get_task',
    'Use this to get a single task with full details. Required: projectId and taskId.',
    {
      projectId: z.string().describe('Project/list ID the task belongs to'),
      taskId: z.string().describe('Task ID'),
    },
    async ({ projectId, taskId }) => {
      try {
        const task = await client.getTask(projectId, taskId);
        return success(task);
      } catch (e: unknown) {
        return error(`Failed to get task: ${formatToolError(e)}`);
      }
    },
  );

  server.tool(
    'ticktick_get_tasks',
    'Use this to list tasks with optional filters. Fetches all tasks from a project (or all projects) and filters client-side. Optional: projectId, tag, dueBefore, dueAfter (YYYY-MM-DD strings), includeCompleted (default false).',
    {
      projectId: z.string().optional().describe('Filter by project/list ID. Omit to search all projects'),
      tag: z.string().optional().describe('Filter by tag (e.g. "@computer")'),
      dueBefore: z.string().optional().describe('Filter tasks due before this date (YYYY-MM-DD)'),
      dueAfter: z.string().optional().describe('Filter tasks due after this date (YYYY-MM-DD)'),
      includeCompleted: z.boolean().optional().default(false).describe('Include completed tasks (default: false)'),
    },
    async ({ projectId, tag, dueBefore, dueAfter, includeCompleted }) => {
      try {
        const filters = GetTasksInput.parse({ projectId, tag, dueBefore, dueAfter, includeCompleted });
        let allTasks: unknown[] = [];
        const warnings: string[] = [];
        let failedProjectCount = 0;

        if (filters.projectId) {
          const data = await client.getProjectData(filters.projectId);
          const parsed = TickTickProjectDataRaw.safeParse(data);
          if (!parsed.success) {
            return error(`Failed to parse project data for project ${filters.projectId}`);
          }
          allTasks = parsed.data.tasks;
        } else {
          const projects = await client.getProjects() as Array<{ id: string }>;
          for (const project of projects) {
            const data = await client.getProjectData(project.id);
            const parsed = TickTickProjectDataRaw.safeParse(data);
            if (parsed.success) {
              allTasks.push(...parsed.data.tasks);
            } else {
              failedProjectCount++;
            }
          }
          if (failedProjectCount > 0) {
            warnings.push(`${failedProjectCount} project(s) could not be parsed and were skipped`);
          }

          // Also fetch inbox tasks
          try {
            const inboxId = await client.getInboxProjectId();
            const inboxData = await client.getProjectData(inboxId);
            const inboxParsed = TickTickProjectDataRaw.safeParse(inboxData);
            if (inboxParsed.success) {
              allTasks.push(...inboxParsed.data.tasks);
            } else {
              warnings.push('Inbox tasks could not be parsed and were skipped');
            }
          } catch {
            warnings.push('Could not fetch inbox tasks — inbox discovery failed');
          }
        }

        let failedTaskCount = 0;
        const validTasks = allTasks
          .map((t) => TickTickTask.safeParse(t))
          .filter((r) => {
            if (!r.success) {
              failedTaskCount++;
              return false;
            }
            return true;
          })
          .map((r) => r.data!);

        if (failedTaskCount > 0) {
          warnings.push(`${failedTaskCount} task(s) could not be parsed and were dropped`);
        }

        const filtered = filterTasks(validTasks, {
          tag: filters.tag,
          dueBefore: filters.dueBefore,
          dueAfter: filters.dueAfter,
          includeCompleted: filters.includeCompleted,
        });

        return success({ tasks: filtered, warnings });
      } catch (e: unknown) {
        return error(`Failed to get tasks: ${formatToolError(e)}`);
      }
    },
  );

  server.tool(
    'ticktick_update_task',
    'Use this to modify an existing task. Required: taskId. Optional: title, content, tags, priority, dueDate, startDate, repeatFlag. Only provided fields are updated.',
    {
      taskId: z.string().describe('Task ID to update'),
      title: z.string().min(1).max(500).optional().describe('New title'),
      content: z.string().max(5000).optional().describe('New description/notes'),
      tags: z.array(z.string()).optional().describe('Replace tags with this array'),
      priority: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5)]).optional().describe('Priority: 0=none, 1=low, 3=medium, 5=high'),
      dueDate: z.string().nullable().optional().describe('Due date (ISO 8601) or null to clear'),
      startDate: z.string().nullable().optional().describe('Start date (ISO 8601) or null to clear'),
      repeatFlag: z.string().optional().describe("iCalendar RRULE string for recurring tasks (e.g., 'RRULE:FREQ=MONTHLY;INTERVAL=1')"),
    },
    async ({ taskId, title, content, tags, priority, dueDate, startDate, repeatFlag }) => {
      try {
        const input = UpdateTaskInput.parse({ taskId, title, content, tags, priority, dueDate, startDate, repeatFlag });
        const { taskId: id, ...updates } = input;
        const task = await client.updateTask(id, updates);
        return success(task);
      } catch (e: unknown) {
        return error(`Failed to update task: ${formatToolError(e)}`);
      }
    },
  );

  server.tool(
    'ticktick_complete_task',
    'Use this to mark a task as done. Required: projectId and taskId.',
    {
      projectId: z.string().describe('Project/list ID the task belongs to'),
      taskId: z.string().describe('Task ID to complete'),
    },
    async ({ projectId, taskId }) => {
      try {
        await client.completeTask(projectId, taskId);
        return success({ completed: true, taskId });
      } catch (e: unknown) {
        return error(`Failed to complete task: ${formatToolError(e)}`);
      }
    },
  );

  server.tool(
    'ticktick_move_task',
    'Use this to move a task from one project/list to another. This creates the task in the target project and completes it in the source. Required: sourceProjectId, taskId, targetProjectId.',
    {
      sourceProjectId: z.string().describe('Current project/list ID'),
      taskId: z.string().describe('Task ID to move'),
      targetProjectId: z.string().describe('Destination project/list ID'),
    },
    async ({ sourceProjectId, taskId, targetProjectId }) => {
      try {
        MoveTaskInput.parse({ sourceProjectId, taskId, targetProjectId });
        const raw = await client.getTask(sourceProjectId, taskId);
        const parsed = TickTickTask.safeParse(raw);
        if (!parsed.success) {
          return error(`Failed to move task: failed to validate the source task. It may not exist or the response was invalid.`);
        }
        const original = parsed.data;
        const newTask = await client.createTask({
          title: original.title,
          content: original.content,
          projectId: targetProjectId,
          tags: original.tags,
          priority: original.priority as 0 | 1 | 3 | 5 | undefined,
          dueDate: original.dueDate ?? undefined,
          startDate: original.startDate ?? undefined,
          repeatFlag: original.repeatFlag,
        });
        await client.completeTask(sourceProjectId, taskId);
        return success({ moved: true, originalTaskId: taskId, newTask });
      } catch (e: unknown) {
        return error(`Failed to move task: ${formatToolError(e)}`);
      }
    },
  );
}
