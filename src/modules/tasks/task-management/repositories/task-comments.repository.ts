import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TaskComment } from '../../../../entities/task-comment.entity';

@Injectable()
export class TaskCommentsRepository {
  constructor(
    @InjectRepository(TaskComment)
    private readonly repo: Repository<TaskComment>,
  ) {}

  async findByTask(taskId: number): Promise<TaskComment[]> {
    return this.repo.find({
      where: { taskId, deletedAt: IsNull() },
      relations: ['author'],
      order: { createdAt: 'ASC' },
    });
  }

  async findByIdActive(id: number): Promise<TaskComment | null> {
    return this.repo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['author'],
    });
  }

  async save(comment: TaskComment): Promise<TaskComment> {
    return this.repo.save(comment);
  }

  async softDelete(id: number): Promise<void> {
    await this.repo.update(id, { deletedAt: new Date() });
  }
}
