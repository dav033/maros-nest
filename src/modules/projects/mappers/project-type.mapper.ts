import { Injectable } from '@nestjs/common';
import { ProjectTypeDto } from '../dto/project-type.dto';
import { ProjectType } from '../../../entities/project-type.entity';

@Injectable()
export class ProjectTypeMapper {
  toEntity(dto: ProjectTypeDto): ProjectType {
    const entity = new ProjectType();
    if (dto.id) entity.id = dto.id;
    entity.name = dto.name;
    entity.color = dto.color;
    return entity;
  }

  toDto(entity: ProjectType): ProjectTypeDto {
    return {
      id: entity.id,
      name: entity.name,
      color: entity.color,
    };
  }
}
