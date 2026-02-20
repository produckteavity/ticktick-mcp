import { describe, it, expect } from 'vitest';
import { filterTasks } from '../../src/filtering.js';
import type { TickTickTaskType } from '../../src/types.js';

const makeTasks = (): TickTickTaskType[] => [
  { id: '1', title: 'Call SLT', projectId: 'p1', status: 0, tags: ['@call'], priority: 1, dueDate: '2026-02-20T00:00:00+0000', content: '' },
  { id: '2', title: 'Fix server', projectId: 'p1', status: 0, tags: ['@computer'], priority: 5, dueDate: '2026-03-01T00:00:00+0000', content: '' },
  { id: '3', title: 'Buy milk', projectId: 'p2', status: 0, tags: ['@errand'], priority: 0, dueDate: null, content: '' },
  { id: '4', title: 'Done task', projectId: 'p1', status: 2, tags: ['@computer'], priority: 0, completedTime: '2026-02-19T00:00:00+0000', content: '' },
];

describe('filterTasks', () => {
  it('filters by tag', () => {
    const result = filterTasks(makeTasks(), { tag: '@computer' });
    expect(result.map((t) => t.id)).toEqual(['2']);
  });

  it('filters by tag (includes completed when requested)', () => {
    const result = filterTasks(makeTasks(), { tag: '@computer', includeCompleted: true });
    expect(result.map((t) => t.id)).toEqual(['2', '4']);
  });

  it('excludes completed by default', () => {
    const result = filterTasks(makeTasks(), {});
    expect(result.every((t) => t.status !== 2)).toBe(true);
  });

  it('filters by dueBefore', () => {
    const result = filterTasks(makeTasks(), { dueBefore: '2026-02-25' });
    expect(result.map((t) => t.id)).toEqual(['1']);
  });

  it('filters by dueAfter', () => {
    const result = filterTasks(makeTasks(), { dueAfter: '2026-02-25' });
    expect(result.map((t) => t.id)).toEqual(['2']);
  });

  it('combines multiple filters', () => {
    const result = filterTasks(makeTasks(), { tag: '@call', dueBefore: '2026-02-25' });
    expect(result.map((t) => t.id)).toEqual(['1']);
  });

  it('returns all incomplete when no filters', () => {
    const result = filterTasks(makeTasks(), {});
    expect(result.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('handles tasks with no due date when dueBefore is set', () => {
    const result = filterTasks(makeTasks(), { dueBefore: '2026-12-31' });
    expect(result.map((t) => t.id)).toEqual(['1', '2']);
  });
});
