import { Injectable } from '@nestjs/common';
import { CompanyService } from '../../../../entities/company-service.entity';
import { CompanyServiceDto } from '../dto/company-service.dto';
import { CreateCompanyServiceDto } from '../dto/create-company-service.dto';
import { UpdateCompanyServiceDto } from '../dto/update-company-service.dto';

@Injectable()
export class CompanyServiceMapper {
  toDto(entity: CompanyService): CompanyServiceDto {
    return {
      id: entity.id,
      name: entity.name,
      color: entity.color,
    };
  }

  toEntity(dto: CreateCompanyServiceDto): CompanyService {
    const entity = new CompanyService();
    entity.name = dto.name;
    entity.color = dto.color;
    return entity;
  }

  updateEntity(dto: UpdateCompanyServiceDto, entity: CompanyService): void {
    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.color !== undefined) entity.color = dto.color;
  }
}
