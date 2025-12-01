import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Lead } from '../../../entities/lead.entity';
import { LeadType } from '../../../common/enums/lead-type.enum';

@Injectable()
export class LeadsRepository {
  constructor(
    @InjectRepository(Lead)
    private readonly repo: Repository<Lead>,
  ) {}

  async findAll(): Promise<Lead[]> {
    return this.repo.find({
      relations: ['contact', 'projectType'],
    });
  }

  async findByLeadType(type: LeadType): Promise<Lead[]> {
    return this.repo.find({
      where: { leadType: type },
      relations: ['contact', 'projectType'],
    });
  }

  async findAllLeadNumbersByType(leadType: LeadType): Promise<string[]> {
    const leads = await this.repo
      .createQueryBuilder('lead')
      .select('lead.leadNumber')
      .where('lead.leadType = :leadType', { leadType })
      .andWhere('lead.leadNumber IS NOT NULL')
      .andWhere("lead.leadNumber != ''")
      .getMany();
    
    // Filter out undefined values (though query already filters NULL)
    // and assert type since we know they're all strings
    return leads.map(l => l.leadNumber).filter((n): n is string => n !== undefined);
  }

  async existsByLeadNumber(leadNumber: string): Promise<boolean> {
    const count = await this.repo.count({ where: { leadNumber } });
    return count > 0;
  }

  async existsByLeadNumberAndIdNot(leadNumber: string, id: number): Promise<boolean> {
    const count = await this.repo.count({ where: { leadNumber, id: Not(id) } });
    return count > 0;
  }

  async findMaxSequenceForMonth(leadType: LeadType, monthYear: string): Promise<number | null> {
    // monthYear format expected: MMYY (e.g., 1123 for Nov 2023)
    // leadNumber format expected: NNN-MMYY (e.g., 001-1123)
    // We need to extract the first part (NNN) and find max
    
    // Using raw query for complex substring/cast logic
    // Postgres specific syntax
    const result = await this.repo.query(
      `
      SELECT MAX(CAST(SUBSTRING(lead_number, 1, 3) AS integer)) as max_seq
      FROM leads
      WHERE lead_type = $1
        AND RIGHT(lead_number, 4) = $2
      `,
      [leadType, monthYear],
    );

    return result[0]?.max_seq || null;
  }

  async findByIdWithRelations(id: number): Promise<Lead | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['contact', 'projectType'],
    });
  }

  async save(lead: Lead): Promise<Lead> {
    return this.repo.save(lead);
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
