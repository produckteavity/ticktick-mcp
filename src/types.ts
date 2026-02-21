import { z } from 'zod';

// --- Input schemas (tool parameters) ---

export const CreateTaskInput = z.object({
  title: z.string().min(1).max(500),
  content: z.string().max(5000).optional(),
  projectId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5)]).optional(),
  dueDate: z.string().optional(),
  startDate: z.string().optional(),
  repeatFlag: z.string().optional(),
});

export const GetTaskInput = z.object({
  projectId: z.string(),
  taskId: z.string(),
});

export const GetTasksInput = z.object({
  projectId: z.string().optional(),
  tag: z.string().optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
  includeCompleted: z.boolean().default(false),
});

export const UpdateTaskInput = z.object({
  taskId: z.string(),
  title: z.string().min(1).max(500).optional(),
  content: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5)]).optional(),
  dueDate: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  repeatFlag: z.string().optional(),
});

export const CompleteTaskInput = z.object({
  projectId: z.string(),
  taskId: z.string(),
});

export const MoveTaskInput = z.object({
  sourceProjectId: z.string(),
  taskId: z.string(),
  targetProjectId: z.string(),
});

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(200),
});

// --- OAuth token response schema ---

export const TokenRefreshResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});

export type TokenRefreshResponseType = z.infer<typeof TokenRefreshResponse>;

// --- API response schemas (output validation) ---

const truncate = (max: number) =>
  z.string().transform((s) => (s.length > max ? s.slice(0, max) : s));

export const TickTickTask = z
  .object({
    id: z.string(),
    title: truncate(500),
    content: truncate(5000).optional().default(''),
    projectId: z.string(),
    status: z.number(),
    tags: z.array(z.string()).optional().default([]),
    priority: z.number().optional().default(0),
    dueDate: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    repeatFlag: z.string().optional(),
    completedTime: z.string().nullable().optional(),
    createdTime: z.string().optional(),
    modifiedTime: z.string().optional(),
  })
  .strip();

export const TickTickProject = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string().optional(),
    sortOrder: z.number().optional(),
    closed: z.boolean().optional(),
    groupId: z.string().nullable().optional(),
    viewMode: z.string().optional(),
    inAll: z.boolean().optional(),
  })
  .strip();

export const TickTickProjectData = z.object({
  project: TickTickProject,
  tasks: z.array(TickTickTask).default([]),
});

// --- Inferred types ---

export type CreateTaskInputType = z.infer<typeof CreateTaskInput>;
export type GetTasksInputType = z.infer<typeof GetTasksInput>;
export type UpdateTaskInputType = z.infer<typeof UpdateTaskInput>;
export type TickTickTaskType = z.infer<typeof TickTickTask>;
export type TickTickProjectType = z.infer<typeof TickTickProject>;
