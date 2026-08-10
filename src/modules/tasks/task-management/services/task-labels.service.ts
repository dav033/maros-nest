import { Injectable } from '@nestjs/common';
import { TaskLabelsRepository } from '../repositories/task-labels.repository';
import { CreateLabelDto } from '../dto/create-label.dto';
import { UpdateLabelDto } from '../dto/update-label.dto';
import { TaskLabel } from '../../../../entities/task-label.entity';
import {
  TaskLabelNotFoundException,
  TaskLabelNameConflictException,
} from '../../../../common/exceptions';

@Injectable()
export class TaskLabelsService {
  constructor(private readonly taskLabelsRepository: TaskLabelsRepository) {}

  private toDto(label: TaskLabel) {
    return { id: label.id, name: label.name, color: label.color };
  }

  async listLabels(): Promise<any[]> {
    const labels = await this.taskLabelsRepository.findAll();
    return labels.map((label) => this.toDto(label));
  }

  async createLabel(dto: CreateLabelDto): Promise<any> {
    const existing = await this.taskLabelsRepository.findByNameCaseInsensitive(dto.name);
    if (existing) throw new TaskLabelNameConflictException(dto.name);

    const label = new TaskLabel();
    label.name = dto.name.trim();
    label.color = dto.color ?? 'neutral';
    const saved = await this.taskLabelsRepository.save(label);
    return this.toDto(saved);
  }

  async updateLabel(id: number, dto: UpdateLabelDto): Promise<any> {
    const label = await this.taskLabelsRepository.findById(id);
    if (!label) throw new TaskLabelNotFoundException(id);

    if (dto.name !== undefined && dto.name.trim().toLowerCase() !== label.name.toLowerCase()) {
      const existing = await this.taskLabelsRepository.findByNameCaseInsensitive(dto.name);
      if (existing) throw new TaskLabelNameConflictException(dto.name);
      label.name = dto.name.trim();
    }
    if (dto.color !== undefined) label.color = dto.color;

    const saved = await this.taskLabelsRepository.save(label);
    return this.toDto(saved);
  }

  async deleteLabel(id: number): Promise<void> {
    const label = await this.taskLabelsRepository.findById(id);
    if (!label) throw new TaskLabelNotFoundException(id);
    await this.taskLabelsRepository.delete(id);
  }
}
