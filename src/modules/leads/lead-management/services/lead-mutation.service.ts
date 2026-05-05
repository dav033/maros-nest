import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../../../../entities/lead.entity';
import { Contact } from '../../../../entities/contact.entity';
import { ProjectType } from '../../../../entities/project-type.entity';
import { Project } from '../../../../entities/project.entity';
import { LeadMapper } from '../mappers/lead.mapper';
import { CreateLeadDto } from '../dto/create-lead.dto';
import {
  ContactExceptions,
  LeadExceptions,
  ProjectTypeExceptions,
} from '../../../../common/exceptions';

@Injectable()
export class LeadMutationService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(ProjectType)
    private readonly projectTypeRepo: Repository<ProjectType>,
    private readonly leadMapper: LeadMapper,
  ) {}

  mapProjectToDto(project: Project): any {
    return {
      id: project.id,
      projectProgressStatus: project.projectProgressStatus,
      quickbooks: project.quickbooks,
      overview: project.overview,
      notes: project.notes,
    };
  }

  async updateLeadNotesOnly(id: number, notes: string[]): Promise<any> {
    const updateResult = await this.leadRepo
      .createQueryBuilder()
      .update(Lead)
      .set({ notes })
      .where('id = :id', { id })
      .execute();

    if (updateResult.affected === 0) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    const updated = await this.leadRepo.findOne({
      where: { id },
      relations: ['contact', 'projectType'],
    });

    if (!updated) {
      throw new LeadExceptions.LeadNotFoundException(id);
    }

    return this.leadMapper.toDto(updated);
  }

  isNotesOnlyUpdate(patchDto: CreateLeadDto): boolean {
    if (
      patchDto.leadNumber !== undefined ||
      patchDto.name !== undefined ||
      patchDto.startDate !== undefined ||
      patchDto.location !== undefined ||
      patchDto.addressLink !== undefined ||
      patchDto.status !== undefined ||
      patchDto.contactId !== undefined ||
      patchDto.projectTypeId !== undefined ||
      patchDto.inReview !== undefined
    ) {
      return false;
    }

    return patchDto.notes !== undefined;
  }

  async updateEntityFields(dto: CreateLeadDto, entity: Lead): Promise<void> {
    if (
      dto.leadNumber !== undefined &&
      dto.leadNumber !== null &&
      dto.leadNumber.trim() !== ''
    ) {
      entity.leadNumber = dto.leadNumber;
    }
    if (dto.name !== undefined) {
      entity.name = dto.name;
    }
    if (dto.startDate !== undefined) {
      if (dto.startDate === null || dto.startDate === '') {
        entity.startDate = undefined;
      } else if (typeof dto.startDate === 'string') {
        entity.startDate = new Date(dto.startDate);
      } else {
        entity.startDate = dto.startDate;
      }
    }
    if (dto.location !== undefined) {
      entity.location = dto.location;
    }
    if (dto.addressLink !== undefined) {
      entity.addressLink = dto.addressLink;
    }
    if (dto.status !== undefined) {
      entity.status = dto.status;
    }
    if (dto.contactId !== undefined) {
      if (dto.contactId === null) {
        entity.contact = null;
      } else {
        const contactEntity = await this.contactRepo.findOne({
          where: { id: dto.contactId },
        });
        if (!contactEntity) {
          throw new ContactExceptions.ContactNotFoundException(dto.contactId);
        }
        entity.contact = contactEntity;
      }
    }
    if (dto.projectTypeId !== undefined) {
      const projectTypeEntity = await this.projectTypeRepo.findOne({
        where: { id: dto.projectTypeId },
      });
      if (!projectTypeEntity) {
        throw new ProjectTypeExceptions.ProjectTypeNotFoundException(
          dto.projectTypeId,
        );
      }
      entity.projectType = projectTypeEntity;
    }
    if (dto.notes !== undefined) {
      entity.notes = dto.notes;
    }
    if (dto.inReview !== undefined) {
      entity.inReview = dto.inReview;
    }
  }

  async resolveProjectType(id: number): Promise<ProjectType> {
    const projectType = await this.projectTypeRepo.findOne({ where: { id } });
    if (!projectType) {
      throw new ProjectTypeExceptions.ProjectTypeNotFoundException(id);
    }
    return projectType;
  }
}
