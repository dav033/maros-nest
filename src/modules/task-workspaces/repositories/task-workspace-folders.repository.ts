import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskWorkspaceFolder } from '../../../entities/task-workspace-folder.entity';

@Injectable()
export class TaskWorkspaceFoldersRepository {
  constructor(@InjectRepository(TaskWorkspaceFolder) private readonly repo: Repository<TaskWorkspaceFolder>) {}
  findById(id: number) { return this.repo.findOne({ where: { id } }); }
  findByWorkspace(workspaceId: number) { return this.repo.find({ where: { workspaceId }, order: { position: 'ASC', id: 'ASC' } }); }
  save(folder: TaskWorkspaceFolder) { return this.repo.save(folder); }
  remove(folder: TaskWorkspaceFolder) { return this.repo.remove(folder); }
}
