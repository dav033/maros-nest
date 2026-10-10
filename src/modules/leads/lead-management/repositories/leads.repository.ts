import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, SelectQueryBuilder } from 'typeorm';
import { Lead } from '../../../../entities/lead.entity';
import { Project } from '../../../../entities/project.entity';
import { LeadType } from '../../../../common/enums/lead-type.enum';
import {
  filterLeadsByType,
  leadNumberSqlFilter,
} from '../../../../common/utils/lead-type.utils';
import { applyLeadTypeScope } from '../../../../common/auth/request-scope';

@Injectable()
export class LeadsRepository {
  constructor(
    @InjectRepository(Lead)
    private readonly repo: Repository<Lead>,
  ) {}

  /**
   * El ambito de tipos de lead del usuario que pregunta, aplicado al final de
   * la consulta.
   *
   * Al final y no al principio porque en TypeORM `.where()` reemplaza las
   * condiciones anteriores: aplicar el ambito antes de un `.where()` lo
   * borraria sin avisar. Un usuario sin restriccion no cambia nada.
   */
  private scoped(qb: SelectQueryBuilder<Lead>): SelectQueryBuilder<Lead> {
    return applyLeadTypeScope(qb, 'lead.lead_number');
  }

  async findAll(): Promise<Lead[]> {
    const qb = this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoinAndSelect('lead.project', 'project')
      .orderBy('lead.id', 'DESC');
    return this.scoped(qb).getMany();
  }

  /**
   * Three columns for the record pickers, nothing hydrated.
   *
   * Deliberately not findAll(): that one left-joins contact, company, projectType and
   * project and selects every column of each, which is what the lead *list* needs and is
   * four joins of waste for a selector that shows a name and a number.
   */
  async findAllForPicker(): Promise<
    Array<{ id: number; name: string | null; lead_number: string | null }>
  > {
    const qb = this.repo
      .createQueryBuilder('lead')
      .select(['lead.id AS id', 'lead.name AS name', 'lead.lead_number AS lead_number'])
      .orderBy('lead.id', 'DESC');
    return this.scoped(qb).getRawMany<{
      id: number;
      name: string | null;
      lead_number: string | null;
    }>();
  }

  async findPipeline(): Promise<Lead[]> {
    // Exclude leads that have an associated project
    // The foreign key is in projects table (lead_id), so we check if a project exists for this lead
    // Also exclude leads that are in review (inReview = true)
    const qb = this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoin(Project, 'project', 'project.lead_id = lead.id')
      .where('project.id IS NULL')
      .andWhere('lead.in_review = false');
    return this.scoped(qb).getMany();
  }

  async findByLeadType(type: LeadType): Promise<Lead[]> {
    const qb = this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoin(Project, 'project', 'project.lead_id = lead.id')
      .where('project.id IS NULL');

    const filter = leadNumberSqlFilter(type, 'lead.lead_number', 'leadNumberPattern');
    if (filter) {
      qb.andWhere(filter.clause, filter.parameters);
    }

    // El ambito se suma al tipo pedido: pedir roofing con ambito de plomeria
    // no devuelve nada, que es lo correcto.
    return this.scoped(qb).orderBy('lead.id', 'DESC').getMany();
  }

  async findConvertedByLeadType(type: LeadType): Promise<Lead[]> {
    const qb = this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoinAndSelect('lead.project', 'project')
      .where('project.id IS NOT NULL');

    const filter = leadNumberSqlFilter(type, 'lead.lead_number', 'leadNumberPattern');
    if (filter) {
      qb.andWhere(filter.clause, filter.parameters);
    }

    return this.scoped(qb).orderBy('lead.id', 'DESC').getMany();
  }

  async findInReview(): Promise<Lead[]> {
    // Obtener todos los leads que están en revisión (inReview = true)
    // Excluir leads que tienen un proyecto asociado
    const qb = this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoin(Project, 'project', 'project.lead_id = lead.id')
      .where('lead.in_review = true')
      .andWhere('project.id IS NULL');
    return this.scoped(qb).getMany();
  }

  /**
   * Deliberadamente SIN el ambito del usuario.
   *
   * Esto alimenta la numeracion de leads. Filtrarlo haria que un usuario
   * restringido a plomeria no viese los numeros de construccion y generase uno
   * ya usado: un filtro de visibilidad convertido en duplicados en la base.
   * Aqui no se devuelve nada al usuario, solo se calcula el siguiente numero.
   */
  async findAllLeadNumbersByType(leadType: LeadType): Promise<string[]> {
    const allLeads = await this.repo
      .createQueryBuilder('lead')
      .select('lead.leadNumber')
      .where('lead.leadNumber IS NOT NULL')
      .andWhere("lead.leadNumber != ''")
      .getMany();

    // Filtrar por tipo usando la función utilitaria
    const filtered = filterLeadsByType(allLeads, leadType);
    return filtered
      .map((l) => l.leadNumber)
      .filter((n): n is string => n !== undefined);
  }

  async existsByLeadNumber(leadNumber: string): Promise<boolean> {
    const count = await this.repo.count({ where: { leadNumber } });
    return count > 0;
  }

  async existsByLeadNumberAndIdNot(
    leadNumber: string,
    id: number,
  ): Promise<boolean> {
    const count = await this.repo.count({ where: { leadNumber, id: Not(id) } });
    return count > 0;
  }

  async findMaxSequenceForMonth(
    leadType: LeadType,
    monthYear: string,
  ): Promise<number | null> {
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

  async findByStatus(status: string): Promise<Lead[]> {
    const qb = this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoinAndSelect('lead.project', 'project')
      .where('lead.status = :status', { status });
    return this.scoped(qb).getMany();
  }

  async getStatusCounts(
    leadType?: LeadType,
  ): Promise<Array<{ status: string; count: number }>> {
    const qb = this.repo
      .createQueryBuilder('lead')
      .select('lead.status', 'status')
      .addSelect('COUNT(lead.id)', 'count')
      .groupBy('lead.status');

    const filter = leadNumberSqlFilter(leadType, 'lead.lead_number', 'leadNumberPattern');
    if (filter) {
      qb.andWhere(filter.clause, filter.parameters);
    }

    const rows: Array<{
      status: string | null;
      count: string;
    }> = await this.scoped(qb).getRawMany();

    return rows.map((row) => ({
      status: row.status ?? 'UNKNOWN',
      count: Number(row.count) || 0,
    }));
  }

  /** Filas ligeras (status, leadNumber) para sumar estimates de QBO por status. */
  async findStatusSeed(
    leadType?: LeadType,
  ): Promise<Array<{ status: string; leadNumber: string | null }>> {
    const qb = this.repo
      .createQueryBuilder('lead')
      .select('lead.status', 'status')
      .addSelect('lead.lead_number', 'leadNumber');

    const filter = leadNumberSqlFilter(leadType, 'lead.lead_number', 'leadNumberPattern');
    if (filter) {
      qb.andWhere(filter.clause, filter.parameters);
    }

    const rows: Array<{ status: string | null; leadNumber: string | null }> =
      await this.scoped(qb).getRawMany();

    return rows.map((row) => ({
      status: row.status ?? 'UNKNOWN',
      leadNumber: row.leadNumber,
    }));
  }

  async getTotalCount(leadType?: LeadType): Promise<number> {
    const qb = this.repo.createQueryBuilder('lead');
    const filter = leadNumberSqlFilter(leadType, 'lead.lead_number', 'leadNumberPattern');
    if (filter) {
      qb.andWhere(filter.clause, filter.parameters);
    }
    return this.scoped(qb).getCount();
  }

  async findByContactId(contactId: number): Promise<Lead[]> {
    const qb = this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoinAndSelect('lead.project', 'project')
      .where('contact.id = :contactId', { contactId });
    return this.scoped(qb).getMany();
  }

  async findByContactName(name: string): Promise<Lead[]> {
    const qb = this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoinAndSelect('lead.project', 'project')
      .where('LOWER(contact.name) LIKE LOWER(:name)', { name: `%${name}%` });
    return this.scoped(qb).getMany();
  }

  async searchByName(name: string): Promise<Lead[]> {
    // Los tres criterios van dentro de UNA condicion entre parentesis. Con tres
    // `orWhere` sueltos, el `andWhere` del ambito se pegaria solo al ultimo —
    // "a OR b OR (c AND ambito)" por precedencia de SQL — y los dos primeros se
    // escaparian del filtro.
    const qb = this.repo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.contact', 'contact')
      .leftJoinAndSelect('contact.company', 'company')
      .leftJoinAndSelect('lead.projectType', 'projectType')
      .leftJoinAndSelect('lead.project', 'project')
      .where(
        '(LOWER(lead.name) LIKE LOWER(:name) OR LOWER(lead.location) LIKE LOWER(:name) OR lead.leadNumber LIKE :num)',
        { name: `%${name}%`, num: `%${name}%` },
      );
    return this.scoped(qb).getMany();
  }

  async findByIdWithRelations(id: number): Promise<Lead | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['contact', 'contact.company', 'projectType', 'project'],
    });
  }

  async findByLeadNumberWithRelations(
    leadNumber: string,
  ): Promise<Lead | null> {
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
