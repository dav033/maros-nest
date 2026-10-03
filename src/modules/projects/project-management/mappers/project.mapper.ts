import { Injectable } from '@nestjs/common';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import { Project } from '../../../../entities/project.entity';
import { sealEndDate } from '../services/project-billing.util';

@Injectable()
export class ProjectMapper {
  toEntity(dto: CreateProjectDto): Project {
    const entity = new Project();
    entity.projectProgressStatus = dto.projectProgressStatus;
    entity.overview = dto.overview;
    entity.notes = dto.notes ?? [];
    entity.attachments = dto.attachments ?? [];

    // Sealed here rather than in the service because this is the one place both the REST
    // and MCP write paths funnel through, so the clock cannot start on one and not the other.
    const sealed = sealEndDate(undefined, entity.projectProgressStatus, entity.endDate, new Date());
    if (sealed) entity.endDate = sealed;

    return entity;
  }

  updateEntity(dto: UpdateProjectDto, entity: Project): void {
    const previousStatus = entity.projectProgressStatus;

    if (dto.projectProgressStatus !== undefined) entity.projectProgressStatus = dto.projectProgressStatus;
    if (dto.overview !== undefined) entity.overview = dto.overview;
    if (dto.notes !== undefined) entity.notes = dto.notes;
    if (dto.attachments !== undefined) entity.attachments = dto.attachments;

    this.applyForecast(dto, entity);

    const sealed = sealEndDate(previousStatus, entity.projectProgressStatus, entity.endDate, new Date());
    if (sealed) entity.endDate = sealed;
  }

  /**
   * El pronostico de coste. `undefined` es "no lo mandaron" y no toca nada;
   * `null` lo borra. La fecha solo se sella cuando alguna de las dos cifras
   * cambia de verdad: refrescarla en cada guardado del proyecto haria pasar por
   * recien revisado un pronostico escrito hace tres meses, que es justo lo que
   * la fecha viene a delatar.
   */
  private applyForecast(dto: UpdateProjectDto, entity: Project): void {
    const before = [entity.forecastMaterialCost, entity.forecastSubcontractorCost];

    if (dto.forecastMaterialCost !== undefined) {
      entity.forecastMaterialCost =
        dto.forecastMaterialCost === null ? null : dto.forecastMaterialCost.toFixed(2);
    }
    if (dto.forecastSubcontractorCost !== undefined) {
      entity.forecastSubcontractorCost =
        dto.forecastSubcontractorCost === null
          ? null
          : dto.forecastSubcontractorCost.toFixed(2);
    }

    const after = [entity.forecastMaterialCost, entity.forecastSubcontractorCost];
    const changed = after.some((value, index) => !sameAmount(value, before[index]));
    if (changed) entity.forecastUpdatedAt = new Date();
  }

  toDto(entity: Project): any {
    const contact = entity.lead?.contact;
    const company = contact?.company;
    const client = contact?.client
      ? { id: contact.id, type: 'contact', name: contact.name || `Contact #${contact.id}`, isClient: !!contact.client, isCustomer: !!contact.customer }
      : company?.client
        ? { id: company.id, type: 'company', name: company.name, isClient: !!company.client, isCustomer: !!company.customer }
        : contact?.customer
          ? { id: contact.id, type: 'contact', name: contact.name || `Contact #${contact.id}`, isClient: !!contact.client, isCustomer: !!contact.customer }
          : company?.customer
            ? { id: company.id, type: 'company', name: company.name, isClient: !!company.client, isCustomer: !!company.customer }
            : null;
    const dto: any = {
      id: entity.id,
      qboCustomerId: entity.qboCustomerId ?? null,
      projectProgressStatus: entity.projectProgressStatus,
      overview: entity.overview,
      notes: entity.notes || [],
      attachments: entity.attachments ?? [],
      leadId: entity.lead ? entity.lead.id : undefined,
      client,
      paymentSummary: null,
      // null de verdad y no 0: la pantalla tiene que poder decir "sin
      // pronostico" en vez de ensenar un cero que nadie escribio.
      forecastMaterialCost: toAmount(entity.forecastMaterialCost),
      forecastSubcontractorCost: toAmount(entity.forecastSubcontractorCost),
      forecastUpdatedAt: entity.forecastUpdatedAt
        ? entity.forecastUpdatedAt.toISOString()
        : null,
    };

    // Include lead information if loaded
    if (entity.lead) {
      dto.lead = {
        id: entity.lead.id,
        name: entity.lead.name,
        leadNumber: entity.lead.leadNumber,
        location: entity.lead.location,
        addressLink: entity.lead.addressLink,
        startDate: entity.lead.startDate,
        status: entity.lead.status,
        contact: entity.lead.contact ? {
          id: entity.lead.contact.id,
          name: entity.lead.contact.name,
          phone: entity.lead.contact.phone,
          email: entity.lead.contact.email,
          isCustomer: entity.lead.contact.customer,
          isClient: entity.lead.contact.client,
        } : null,
        projectType: entity.lead.projectType ? {
          id: entity.lead.projectType.id,
          name: entity.lead.projectType.name,
          color: entity.lead.projectType.color,
        } : null,
        notes: entity.lead.notes || [],
      };
    }

    return dto;
  }
}

/**
 * `numeric` vuelve de Postgres como cadena ("105600.23"), y comparar cadenas
 * daria por cambiado un 1000 reescrito como 1000.00.
 */
function sameAmount(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Number(a) === Number(b);
}

function toAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
