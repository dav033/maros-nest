import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyService } from '../../../entities/company-service.entity';
import { CompanyServicesRepository } from '../repositories/company-services.repository';
import { CompanyServiceMapper } from '../mappers/company-service.mapper';
import { CreateCompanyServiceDto } from '../dto/create-company-service.dto';
import { UpdateCompanyServiceDto } from '../dto/update-company-service.dto';
import { ValidationException, ResourceNotFoundException } from '../../../common/exceptions';
import { BaseService } from '../../../common/services/base.service';

@Injectable()
export class CompanyServicesService extends BaseService<any, number, CompanyService> {
  constructor(
    private readonly companyServicesRepository: CompanyServicesRepository,
    @InjectRepository(CompanyService)
    private readonly companyServiceRepo: Repository<CompanyService>,
    private readonly companyServiceMapper: CompanyServiceMapper,
  ) {
    super(companyServiceRepo, companyServiceMapper);
  }

  async create(dto: CreateCompanyServiceDto): Promise<any> {
    if (dto.name && await this.companyServicesRepository.existsByNameIgnoreCase(dto.name)) {
      throw ValidationException.format('Company service name already exists: %s', dto.name);
    }
    const entity = this.companyServiceMapper.toEntity(dto);
    const saved = await this.companyServiceRepo.save(entity);
    return this.companyServiceMapper.toDto(saved);
  }

  async update(id: number, dto: UpdateCompanyServiceDto): Promise<any> {
    const entity = await this.companyServiceRepo.findOne({ where: { id } });
    if (!entity) {
      throw new ResourceNotFoundException(`Company service not found with id: ${id}`);
    }

    if (dto.name) {
      const exists = await this.companyServicesRepository.existsByNameIgnoreCase(dto.name);
      if (exists) {
        const existing = await this.companyServiceRepo
          .createQueryBuilder('service')
          .where('LOWER(service.name) = LOWER(:name)', { name: dto.name })
          .getOne();
        
        if (existing && existing.id !== id) {
          throw ValidationException.format('Company service name already exists: %s', dto.name);
        }
      }
    }

    this.companyServiceMapper.updateEntity(dto, entity);
    const saved = await this.companyServiceRepo.save(entity);
    return this.companyServiceMapper.toDto(saved);
  }
}
