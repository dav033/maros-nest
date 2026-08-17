import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TaskParty, TaskPartyKind } from '../../../../entities/task-party.entity';
import type { TaskPartyInputDto } from '../dto/set-parties.dto';

@Injectable()
export class TaskPartiesService {
  constructor(
    @InjectRepository(TaskParty)
    private readonly repo: Repository<TaskParty>,
    private readonly dataSource: DataSource,
  ) {}

  list(taskId: number): Promise<TaskParty[]> {
    return this.repo.find({ where: { taskId }, order: { partyKind: 'ASC', partyId: 'ASC' } });
  }

  async replace(taskId: number, inputs: TaskPartyInputDto[]): Promise<TaskParty[]> {
    const unique = new Map<string, TaskPartyInputDto>();
    for (const input of inputs) unique.set(`${input.partyKind}:${input.partyId}`, input);
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TaskParty);
      await repository.delete({ taskId });
      const rows = [...unique.values()].map((input) => repository.create({
        taskId,
        partyKind: input.partyKind,
        partyId: input.partyId,
        role: input.role?.trim() || 'related',
      }));
      if (rows.length) await repository.save(rows);
    });
    return this.list(taskId);
  }

  async findTaskIdsByParty(partyKind: TaskPartyKind, partyId: number): Promise<number[]> {
    const rows = await this.repo.find({ select: ['taskId'], where: { partyKind, partyId } });
    return rows.map((row) => row.taskId);
  }
}
