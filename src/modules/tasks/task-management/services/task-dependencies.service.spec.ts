import { BadRequestException } from '@nestjs/common';
import { TaskDependenciesService } from './task-dependencies.service';

describe('TaskDependenciesService', () => {
  const dependencyRepo = {
    find: jest.fn(),
    delete: jest.fn(),
    save: jest.fn(),
  };
  const taskRepo = { count: jest.fn() };
  const service = new TaskDependenciesService(dependencyRepo as never, taskRepo as never);

  beforeEach(() => {
    jest.clearAllMocks();
    taskRepo.count.mockResolvedValue(1);
    dependencyRepo.save.mockResolvedValue([]);
    dependencyRepo.find.mockResolvedValue([]);
  });

  it('rejects a dependency graph that would create a cycle', async () => {
    dependencyRepo.find
      .mockResolvedValueOnce([{ taskId: 2, dependsOnTaskId: 3 }])
      .mockResolvedValueOnce([{ taskId: 3, dependsOnTaskId: 1 }]);

    await expect(service.replace(1, [2])).rejects.toBeInstanceOf(BadRequestException);
    expect(dependencyRepo.delete).not.toHaveBeenCalled();
  });

  it('replaces a valid dependency set', async () => {
    await expect(service.replace(1, [2])).resolves.toEqual([]);
    expect(dependencyRepo.delete).toHaveBeenCalledWith({ taskId: 1 });
    expect(dependencyRepo.save).toHaveBeenCalledWith([{ taskId: 1, dependsOnTaskId: 2 }]);
  });
});
