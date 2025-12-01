import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadClickUpMapping } from '../../../entities/lead-clickup-mapping.entity';

@Injectable()
export class LeadClickUpMappingRepository {
  constructor(
    @InjectRepository(LeadClickUpMapping)
    private readonly repo: Repository<LeadClickUpMapping>,
  ) {}

  async findByLeadId(leadId: number): Promise<LeadClickUpMapping | null> {
    return this.repo.findOne({ where: { lead: { id: leadId } } });
  }

  async findByLeadNumber(leadNumber: string): Promise<LeadClickUpMapping | null> {
    return this.repo.findOne({ where: { leadNumber } });
  }

  async findByClickUpTaskId(clickUpTaskId: string): Promise<LeadClickUpMapping | null> {
    return this.repo.findOne({ where: { clickUpTaskId } });
  }

  async deleteByLeadId(leadId: number): Promise<void> {
    await this.repo.delete({ lead: { id: leadId } });
  }

  async deleteByClickUpTaskId(clickUpTaskId: string): Promise<void> {
    await this.repo.delete({ clickUpTaskId });
  }

  async save(mapping: LeadClickUpMapping): Promise<LeadClickUpMapping> {
    return this.repo.save(mapping);
  }
}
