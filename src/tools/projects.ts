import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TickTickClient } from '../ticktick-client.js';
import { formatToolError } from './tasks.js';

function success(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function error(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const };
}

export function registerProjectTools(server: McpServer, client: TickTickClient): void {
  server.tool(
    'ticktick_get_projects',
    'Use this to list all TickTick projects/lists. Returns an array of projects with id, name, and other metadata. No parameters required.',
    {},
    async () => {
      try {
        const projects = await client.getProjects();

        // Try to include inbox project
        try {
          const inboxId = await client.getInboxProjectId();
          const alreadyIncluded = (projects as Array<{ id: string }>).some((p) => p.id === inboxId);
          if (!alreadyIncluded) {
            const inboxData = await client.getProjectData(inboxId);
            const parsed = inboxData && typeof inboxData === 'object' && 'project' in inboxData
              ? (inboxData as { project: unknown }).project
              : null;
            if (parsed) {
              return success([parsed, ...(projects as unknown[])]);
            }
          }
        } catch {
          // Inbox discovery failed — return regular projects only
        }

        return success(projects);
      } catch (e: unknown) {
        return error(`Failed to get projects: ${formatToolError(e)}`);
      }
    },
  );

  server.tool(
    'ticktick_create_project',
    'Use this to create a new TickTick project/list. Required: name (1-200 characters).',
    {
      name: z.string().min(1).max(200).describe('Name for the new project/list'),
    },
    async ({ name }) => {
      try {
        const project = await client.createProject({ name });
        return success(project);
      } catch (e: unknown) {
        return error(`Failed to create project: ${formatToolError(e)}`);
      }
    },
  );
}
