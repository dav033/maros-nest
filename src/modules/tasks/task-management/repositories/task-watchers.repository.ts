import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskWatcher } from '../../../../entities/task-watcher.entity';

@Injectable()
export class TaskWatchersRepository {
  constructor(
    @InjectRepository(TaskWatcher)
    private readonly repo: Repository<TaskWatcher>,
  ) {}

  /**
   * Seeds one or more watchers. Duplicates (the same person already watching, or
   * reporter and assignee being the same user) stay a no-op — callers don't check
   * first, same as NotesRepository.addFavorite.
   */
  async addMany(taskId: number, userIds: Array<number | null | undefined>): Promise<void> {
    const unique = Array.from(new Set(userIds.filter((id): id is number => id != null)));
    if (unique.length === 0) return;
    await this.repo
      .createQueryBuilder()
      .insert()
      .values(unique.map((userId) => ({ taskId, userId })))
      .orIgnore()
      .execute();
  }

  async findUserIdsForTask(taskId: number): Promise<number[]> {
    const rows = await this.repo.find({ where: { taskId }, select: { userId: true } });
    return rows.map((row) => row.userId);
  }

  async remove(taskId: number, userId: number): Promise<void> {
    await this.repo.delete({ taskId, userId });
  }
}
