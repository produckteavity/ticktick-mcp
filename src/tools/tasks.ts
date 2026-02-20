import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TickTickClient } from '../ticktick-client.js';
import { CreateTaskInput, GetTaskInput, GetTasksInput, UpdateTaskInput, CompleteTaskInput, MoveTaskInput, TickTickTask, TickTickProjectData } from '../types.js';
import { filterTasks } from '../filtering.js';

function success(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function error(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

export function registerTaskTools(server: McpServer, client: TickTickClient): void {
  server.tool(
    'ticktick_create_task',
    'Use this to create a new task in TickTick. Required: title. Optional: content, projectId (omit for Inbox), tags (array of strings), priority (0=none, 1=low, 3=medium, 5=high), dueDate, startDate (ISO 8601 strings).',
    {
      title: z.string().min(1).max(500).describe('Task title'),
      content: z.string().max(5000).optional().describe('Task description/notes'),
      projectId: z.string().optional().describe('Project/list ID. Omit to add to Inbox'),
      tags: z.array(z.string()).optional().describe('Tags (e.g. ["@call", "@computer"])'),
      priority: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5)]).optional().describe('Priority: 0=none, 1=low, 3=medium, 5=high'),
      dueDate: z.string().optional().describe('Due date in ISO 8601 format'),
      startDate: z.string().optional().describe('Start date in ISO 8601 format'),
    },
    async ({ title, content, projectId, tags, priority, dueDate, startDate }) => {
      try {
        const input = CreateTaskInput.parse({ title, content, projectId, tags, priority, dueDate, startDate });
        const task = await client.createTask(input);
        return success(task);
      } catch (e: any) {
        return error(`Failed to create task: ${e.message}`);
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
      } catch (e: any) {
        return error(`Failed to get task: ${e.message}`);
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

        if (filters.projectId) {
          const data = await client.getProjectData(filters.projectId);
          const parsed = TickTickProjectData.safeParse(data);
          allTasks = parsed.success ? parsed.data.tasks : [];
        } else {
          const projects = await client.getProjects() as Array<{ id: string }>;
          for (const project of projects) {
            const data = await client.getProjectData(project.id);
            const parsed = TickTickProjectData.safeParse(data);
            if (parsed.success) {
              allTasks.push(...parsed.data.tasks);
            }
          }
        }

        const validTasks = allTasks
          .map((t) => TickTickTask.safeParse(t))
          .filter((r) => r.success)
          .map((r) => r.data!);

        const filtered = filterTasks(validTasks, {
          tag: filters.tag,
          dueBefore: filters.dueBefore,
          dueAfter: filters.dueAfter,
          includeCompleted: filters.includeCompleted,
        });

        return success(filtered);
      } catch (e: any) {
        return error(`Failed to get tasks: ${e.message}`);
      }
    },
  );

  server.tool(
    'ticktick_update_task',
    'Use this to modify an existing task. Required: taskId. Optional: title, content, tags, priority, dueDate, startDate. Only provided fields are updated.',
    {
      taskId: z.string().describe('Task ID to update'),
      title: z.string().min(1).max(500).optional().describe('New title'),
      content: z.string().max(5000).optional().describe('New description/notes'),
      tags: z.array(z.string()).optional().describe('Replace tags with this array'),
      priority: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5)]).optional().describe('Priority: 0=none, 1=low, 3=medium, 5=high'),
      dueDate: z.string().nullable().optional().describe('Due date (ISO 8601) or null to clear'),
      startDate: z.string().nullable().optional().describe('Start date (ISO 8601) or null to clear'),
    },
    async ({ taskId, title, content, tags, priority, dueDate, startDate }) => {
      try {
        const input = UpdateTaskInput.parse({ taskId, title, content, tags, priority, dueDate, startDate });
        const { taskId: id, ...updates } = input;
        const task = await client.updateTask(id, updates);
        return success(task);
      } catch (e: any) {
        return error(`Failed to update task: ${e.message}`);
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
      } catch (e: any) {
        return error(`Failed to complete task: ${e.message}`);
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
        const original = await client.getTask(sourceProjectId, taskId) as any;
        const newTask = await client.createTask({
          title: original.title,
          content: original.content,
          projectId: targetProjectId,
          tags: original.tags,
          priority: original.priority,
          dueDate: original.dueDate,
          startDate: original.startDate,
        });
        await client.completeTask(sourceProjectId, taskId);
        return success({ moved: true, originalTaskId: taskId, newTask });
      } catch (e: any) {
        return error(`Failed to move task: ${e.message}`);
      }
    },
  );
}
