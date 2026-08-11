import { TaskMapper } from './task.mapper';
import { Task } from '../../../../entities/task.entity';

function task(overrides: Partial<Task> = {}): Task {
  return Object.assign(new Task(), {
    id: 1,
    title: 'Task',
    kind: 'general',
    status: 'todo',
    priority: 'normal',
    position: 1000,
    parent: null,
    blockedReason: null,
    completedAt: null,
    labels: [],
    ...overrides,
  });
}

describe('TaskMapper.toSummaryDto counts', () => {
  it('defaults subtasksTotal/subtasksDone/commentsCount to zero when no counts are given', () => {
    const mapper = new TaskMapper();

    const dto = mapper.toSummaryDto(task());

    expect(dto.subtasksTotal).toBe(0);
    expect(dto.subtasksDone).toBe(0);
    expect(dto.commentsCount).toBe(0);
  });

  it('carries the given counts through', () => {
    const mapper = new TaskMapper();

    const dto = mapper.toSummaryDto(task(), { subtasksTotal: 4, subtasksDone: 2, commentsCount: 3 });

    expect(dto.subtasksTotal).toBe(4);
    expect(dto.subtasksDone).toBe(2);
    expect(dto.commentsCount).toBe(3);
  });
});

describe('TaskMapper.toDetailDto counts', () => {
  it('derives subtask counts from the children list and takes commentsCount from the caller', () => {
    const mapper = new TaskMapper();
    const children = [task({ id: 2, status: 'done' }), task({ id: 3, status: 'todo' })];

    const dto = mapper.toDetailDto(task(), children, [], 5);

    expect(dto.subtasksTotal).toBe(2);
    expect(dto.subtasksDone).toBe(1);
    expect(dto.commentsCount).toBe(5);
  });
});

describe('TaskMapper.groupByStatus with counts', () => {
  it('looks each task up in the counts map by id', () => {
    const mapper = new TaskMapper();
    const tasks = [task({ id: 1, status: 'todo' }), task({ id: 2, status: 'in_progress' })];
    const counts = new Map([
      [1, { subtasksTotal: 3, subtasksDone: 1, commentsCount: 0 }],
      [2, { subtasksTotal: 0, subtasksDone: 0, commentsCount: 7 }],
    ]);

    const groups = mapper.groupByStatus(tasks, counts);

    expect(groups.todo[0].subtasksTotal).toBe(3);
    expect(groups.in_progress[0].commentsCount).toBe(7);
  });
});

describe('TaskMapper.bucketByDueDate with counts', () => {
  it('looks each task up in the counts map by id', () => {
    const mapper = new TaskMapper();
    const tasks = [task({ id: 1, dueDate: null })];
    const counts = new Map([[1, { subtasksTotal: 2, subtasksDone: 2, commentsCount: 1 }]]);

    const buckets = mapper.bucketByDueDate(tasks, counts);

    expect(buckets.noDueDate[0].subtasksTotal).toBe(2);
    expect(buckets.noDueDate[0].commentsCount).toBe(1);
  });
});
