import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskActivity, TaskActivityKind } from '../../../../entities/task-activity.entity';

export interface LogActivityInput {
  taskId: number;
  actorId: number | null;
  kind: TaskActivityKind;
  fromValue?: string | null;
  toValue?: string | null;
}

/** Append-only — see TaskActivity. Nothing here ever updates or deletes a row directly. */
@Injectable()
export class TaskActivityRepository {
  constructor(
    @InjectRepository(TaskActivity)
    private readonly repo: Repository<TaskActivity>,
  ) {}

  async log(entry: LogActivityInput): Promise<TaskActivity> {
    const row = this.repo.create(entry);
    return this.repo.save(row);
  }

  async findByTask(taskId: number): Promise<TaskActivity[]> {
    return this.repo.find({
      where: { taskId },
      relations: ['actor'],
      order: { createdAt: 'DESC' },
    });
  }
}
