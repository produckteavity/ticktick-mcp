import type { TickTickTaskType, GetTasksInputType } from './types.js';

type FilterOptions = Omit<GetTasksInputType, 'projectId'>;

export function filterTasks(
  tasks: TickTickTaskType[],
  options: FilterOptions,
): TickTickTaskType[] {
  return tasks.filter((task) => {
    if (!options.includeCompleted && task.status === 2) {
      return false;
    }

    if (options.tag && !(task.tags ?? []).includes(options.tag)) {
      return false;
    }

    if (options.dueBefore) {
      if (!task.dueDate) return false;
      const taskDate = new Date(task.dueDate).getTime();
      const beforeDate = new Date(options.dueBefore + 'T23:59:59Z').getTime();
      if (taskDate > beforeDate) return false;
    }

    if (options.dueAfter) {
      if (!task.dueDate) return false;
      const taskDate = new Date(task.dueDate).getTime();
      const afterDate = new Date(options.dueAfter + 'T00:00:00Z').getTime();
      if (taskDate < afterDate) return false;
    }

    return true;
  });
}
