import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TaskLabel } from '../../../../entities/task-label.entity';

@Injectable()
export class TaskLabelsRepository {
  constructor(
    @InjectRepository(TaskLabel)
    private readonly repo: Repository<TaskLabel>,
  ) {}

  async findAll(): Promise<TaskLabel[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  async findById(id: number): Promise<TaskLabel | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByIds(ids: number[]): Promise<TaskLabel[]> {
    if (ids.length === 0) return [];
    return this.repo.find({ where: { id: In(ids) } });
  }

  async findByNameCaseInsensitive(name: string): Promise<TaskLabel | null> {
    return this.repo
      .createQueryBuilder('label')
      .where('LOWER(label.name) = LOWER(:name)', { name })
      .getOne();
  }

  async save(label: TaskLabel): Promise<TaskLabel> {
    return this.repo.save(label);
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
