import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskSavedView } from '../../../../entities/task-saved-view.entity';
import type { CreateTaskSavedViewDto } from '../dto/task-saved-view.dto';

@Injectable()
export class TaskSavedViewsService {
  constructor(@InjectRepository(TaskSavedView) private readonly repo: Repository<TaskSavedView>) {}

  list(userId: number): Promise<TaskSavedView[]> {
    return this.repo.createQueryBuilder('view')
      .where('view.owner_id = :userId OR view.shared = true', { userId })
      .orderBy('view.name', 'ASC')
      .getMany();
  }

  create(userId: number, dto: CreateTaskSavedViewDto): Promise<TaskSavedView> {
    return this.repo.save(this.repo.create({ ownerId: userId, name: dto.name.trim(), state: dto.state, shared: dto.shared ?? false }));
  }

  async remove(userId: number, id: number): Promise<void> {
    const result = await this.repo.delete({ id, ownerId: userId });
    if (!result.affected) throw new NotFoundException('Saved task view not found');
  }
}
