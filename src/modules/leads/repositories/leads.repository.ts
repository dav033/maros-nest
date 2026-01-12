import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Lead } from '../../../entities/lead.entity';
import { Project } from '../../../entities/project.entity';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { getLeadTypeFromNumber, filterLeadsByType } from '../../../common/utils/lead-type.utils';

@Injectable()
export class LeadsRepository {
  constructor(
    @InjectRepository(Lead)
    private readonly repo: Repository<Lead>,
  ) {}

  async findAll(): Promise<Lead[]> {
    // Exclude leads that have an associated project
    // The foreign key is in projects table (lead_id), so we check if a project exists for this lead
    // Also exclude leads that are in review (inReview = true)
    return this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoin(Project, 'project', 'project.lead_id = lead.id')
      .where('project.id IS NULL')
      .andWhere('lead.in_review = false')
      .getMany();
  }

  async findByLeadType(type: LeadType): Promise<Lead[]> {
    // Obtener todos los leads sin proyecto y filtrar por tipo usando la función utilitaria
    // The foreign key is in projects table (lead_id), so we check if a project exists for this lead
    // Also exclude leads that are in review (inReview = true)
    const allLeads = await this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoin(Project, 'project', 'project.lead_id = lead.id')
      .where('project.id IS NULL')
      .andWhere('lead.in_review = false')
      .getMany();
    return filterLeadsByType(allLeads, type);
  }

  async findInReview(): Promise<Lead[]> {
    // Obtener todos los leads que están en revisión (inReview = true)
    // Excluir leads que tienen un proyecto asociado
    return this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoin(Project, 'project', 'project.lead_id = lead.id')
      .where('lead.in_review = true')
      .andWhere('project.id IS NULL')
      .getMany();
  }

  async findAllLeadNumbersByType(leadType: LeadType): Promise<string[]> {
    const allLeads = await this.repo
      .createQueryBuilder('lead')
      .select('lead.leadNumber')
      .where('lead.leadNumber IS NOT NULL')
      .andWhere("lead.leadNumber != ''")
      .getMany();
    
    // Filtrar por tipo usando la función utilitaria
    const filtered = filterLeadsByType(allLeads, leadType);
    return filtered.map(l => l.leadNumber).filter((n): n is string => n !== undefined);
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
    // leadNumber format expected: NNN-MMYY (e.g., 001-1123) o NNNR-MMYY, NNNP-MMYY
    // We need to extract the first part (NNN) and find max
    
    // Construir el patrón según el tipo
    let pattern = '';
    if (leadType === LeadType.ROOFING) {
      pattern = '%R-' + monthYear;
    } else if (leadType === LeadType.PLUMBING) {
      pattern = '%P-' + monthYear;
    } else {
      pattern = '%-' + monthYear;
    }
    
    // Using raw query for complex substring/cast logic
    // Postgres specific syntax
    const result = await this.repo.query(
      `
      SELECT MAX(CAST(SUBSTRING(lead_number, 1, 3) AS integer)) as max_seq
      FROM leads
      WHERE lead_number LIKE $1
        AND RIGHT(lead_number, 4) = $2
      `,
      [pattern, monthYear],
    );

    return result[0]?.max_seq || null;
  }

  async findByIdWithRelations(id: number): Promise<Lead | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['contact', 'contact.company', 'projectType'],
    });
  }

  async findByLeadNumberWithRelations(leadNumber: string): Promise<Lead | null> {
    return this.repo.findOne({
      where: { leadNumber },
      relations: ['contact', 'contact.company', 'projectType'],
    });
  }

  async save(lead: Lead): Promise<Lead> {
    return this.repo.save(lead);
  }

  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
