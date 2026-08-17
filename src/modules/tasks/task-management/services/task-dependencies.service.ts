import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TaskDependency } from '../../../../entities/task-dependency.entity';
import { Task } from '../../../../entities/task.entity';

@Injectable()
export class TaskDependenciesService {
  constructor(
    @InjectRepository(TaskDependency) private readonly deps: Repository<TaskDependency>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
  ) {}

  async list(taskId: number): Promise<number[]> {
    const rows = await this.deps.find({ where: { taskId }, order: { dependsOnTaskId: 'ASC' } });
    return rows.map((row) => row.dependsOnTaskId);
  }

  async replace(taskId: number, dependsOnTaskIds: number[]): Promise<number[]> {
    if (dependsOnTaskIds.includes(taskId)) throw new BadRequestException('A task cannot depend on itself');
    const unique = [...new Set(dependsOnTaskIds)];
    if (unique.length) {
      const existing = await this.tasks.count({ where: { id: In(unique) } });
      if (existing !== unique.length) throw new NotFoundException('One or more dependency tasks do not exist');

      // Edges point from a task to its blockers. Adding task -> dependency is
      // invalid when one of the proposed blockers already reaches task.
      const visited = new Set<number>();
      let frontier = unique;
      while (frontier.length > 0) {
        const rows = await this.deps.find({ where: { taskId: In(frontier) } });
        const next: number[] = [];
        for (const row of rows) {
          if (row.dependsOnTaskId === taskId) {
            throw new BadRequestException('Task dependencies cannot contain a cycle');
          }
          if (!visited.has(row.dependsOnTaskId)) {
            visited.add(row.dependsOnTaskId);
            next.push(row.dependsOnTaskId);
          }
        }
        frontier = next;
      }
    }
    await this.deps.delete({ taskId });
    if (unique.length) await this.deps.save(unique.map((dependsOnTaskId) => ({ taskId, dependsOnTaskId })));
    return this.list(taskId);
  }

  async hasOpenDependencies(taskId: number): Promise<boolean> {
    return (await this.deps.createQueryBuilder('dependency')
      .innerJoin(Task, 'blocker', 'blocker.id = dependency.depends_on_task_id')
      .where('dependency.task_id = :taskId', { taskId })
      .andWhere('blocker.deleted_at IS NULL')
      .andWhere('blocker.status NOT IN (:...closed)', { closed: ['done', 'cancelled'] })
      .getCount()) > 0;
  }
}
