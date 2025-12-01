import { Injectable } from '@nestjs/common';
import { CompanyServiceDto } from '../dto/company-service.dto';
import { CompanyService } from '../../../entities/company-service.entity';

@Injectable()
export class CompanyServiceMapper {
  toEntity(dto: CompanyServiceDto): CompanyService {
    const entity = new CompanyService();
    if (dto.id) entity.id = dto.id;
    entity.name = dto.name;
    entity.color = dto.color;
    return entity;
  }

  toDto(entity: CompanyService): CompanyServiceDto {
    return {
      id: entity.id,
      name: entity.name,
      color: entity.color,
    };
  }

  updateEntity(dto: any, entity: CompanyService): void {
    if (dto.name !== undefined) {
      entity.name = dto.name;
    }
    if (dto.color !== undefined) {
      entity.color = dto.color;
    }
  }
}
