import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskTemplate } from '../../../../entities/task-template.entity';
import { TaskTemplateItem } from '../../../../entities/task-template-item.entity';
import type { TaskActor } from './task-actor';
import type { CreateTaskTemplateDto } from '../dto/task-template.dto';
import { TasksService } from '../tasks.service';

@Injectable()
export class TaskTemplatesService {
  constructor(
    @InjectRepository(TaskTemplate) private readonly templates: Repository<TaskTemplate>,
    @InjectRepository(TaskTemplateItem) private readonly items: Repository<TaskTemplateItem>,
    private readonly tasksService: TasksService,
  ) {}

  list(): Promise<TaskTemplate[]> {
    return this.templates.find({ where: { active: true }, relations: ['items'], order: { name: 'ASC' } });
  }

  async create(dto: CreateTaskTemplateDto): Promise<TaskTemplate> {
    const template = await this.templates.save(this.templates.create({
      name: dto.name.trim(),
      projectType: dto.projectType?.trim() || null,
      items: dto.items.map((item, position) => this.items.create({
        title: item.title.trim(),
        kind: item.kind ?? 'general',
        priority: item.priority ?? 'normal',
        offsetDays: item.offsetDays ?? 0,
        position,
      })),
    }));
    return this.templates.findOneOrFail({ where: { id: template.id }, relations: ['items'] });
  }

  async apply(templateId: number, leadId: number, startDate: string | undefined, actor: TaskActor): Promise<any[]> {
    const template = await this.templates.findOne({ where: { id: templateId, active: true }, relations: ['items'] });
    if (!template) throw new NotFoundException('Task template not found');
    const anchor = startDate ? new Date(`${startDate}T00:00:00Z`) : new Date();
    const created: any[] = [];
    for (const item of [...template.items].sort((a, b) => a.position - b.position)) {
      const due = new Date(anchor);
      due.setUTCDate(due.getUTCDate() + item.offsetDays);
      created.push(await this.tasksService.create({
        title: item.title,
        kind: item.kind,
        priority: item.priority,
        entityKind: 'lead',
        entityId: leadId,
        dueDate: due.toISOString().slice(0, 10),
      }, actor));
    }
    return created;
  }
}
