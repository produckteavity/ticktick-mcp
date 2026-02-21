import { describe, it, expect } from 'vitest';
import {
  CreateTaskInput,
  UpdateTaskInput,
  GetTasksInput,
  MoveTaskInput,
  TickTickTask,
  TickTickProject,
} from '../../src/types.js';

describe('CreateTaskInput', () => {
  it('accepts valid minimal input', () => {
    const result = CreateTaskInput.safeParse({ title: 'Buy milk' });
    expect(result.success).toBe(true);
  });

  it('accepts full input with all fields', () => {
    const result = CreateTaskInput.safeParse({
      title: 'Call SLT about internet',
      content: 'Ask about fiber upgrade options',
      projectId: 'abc123',
      tags: ['@call', '@home'],
      priority: 3,
      dueDate: '2026-03-01T00:00:00+0000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = CreateTaskInput.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects title over 500 chars', () => {
    const result = CreateTaskInput.safeParse({ title: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority', () => {
    const result = CreateTaskInput.safeParse({ title: 'Test', priority: 2 });
    expect(result.success).toBe(false);
  });

  it('accepts optional repeatFlag', () => {
    const result = CreateTaskInput.safeParse({
      title: 'Monthly review',
      repeatFlag: 'RRULE:FREQ=MONTHLY;INTERVAL=1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repeatFlag).toBe('RRULE:FREQ=MONTHLY;INTERVAL=1');
    }
  });

  it('accepts input without repeatFlag', () => {
    const result = CreateTaskInput.safeParse({ title: 'One-off task' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repeatFlag).toBeUndefined();
    }
  });

  it('rejects non-string repeatFlag', () => {
    const result = CreateTaskInput.safeParse({ title: 'Test', repeatFlag: 123 });
    expect(result.success).toBe(false);
  });
});

describe('UpdateTaskInput', () => {
  it('accepts optional repeatFlag', () => {
    const result = UpdateTaskInput.safeParse({
      taskId: 'task123',
      repeatFlag: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repeatFlag).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2');
    }
  });

  it('accepts input without repeatFlag', () => {
    const result = UpdateTaskInput.safeParse({
      taskId: 'task123',
      title: 'Updated title',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repeatFlag).toBeUndefined();
    }
  });

  it('rejects non-string repeatFlag', () => {
    const result = UpdateTaskInput.safeParse({ taskId: 'task123', repeatFlag: true });
    expect(result.success).toBe(false);
  });
});

describe('GetTasksInput', () => {
  it('accepts empty input (all tasks)', () => {
    const result = GetTasksInput.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts projectId filter', () => {
    const result = GetTasksInput.safeParse({ projectId: 'abc123' });
    expect(result.success).toBe(true);
  });

  it('accepts combined filters', () => {
    const result = GetTasksInput.safeParse({
      projectId: 'abc123',
      tag: '@computer',
      dueBefore: '2026-03-01',
      includeCompleted: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('TickTickTask (API response)', () => {
  it('parses a valid API response', () => {
    const result = TickTickTask.safeParse({
      id: 'task123',
      title: 'Test task',
      projectId: 'proj456',
      status: 0,
    });
    expect(result.success).toBe(true);
  });

  it('truncates title over 500 chars', () => {
    const result = TickTickTask.safeParse({
      id: 'task123',
      title: 'a'.repeat(600),
      projectId: 'proj456',
      status: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title.length).toBeLessThanOrEqual(500);
    }
  });

  it('preserves repeatFlag from API response', () => {
    const result = TickTickTask.safeParse({
      id: 'task123',
      title: 'Recurring task',
      projectId: 'proj456',
      status: 0,
      repeatFlag: 'RRULE:FREQ=DAILY;INTERVAL=1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repeatFlag).toBe('RRULE:FREQ=DAILY;INTERVAL=1');
    }
  });

  it('strips unknown fields', () => {
    const result = TickTickTask.safeParse({
      id: 'task123',
      title: 'Test',
      projectId: 'proj456',
      status: 0,
      unknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('unknownField' in result.data).toBe(false);
    }
  });
});
