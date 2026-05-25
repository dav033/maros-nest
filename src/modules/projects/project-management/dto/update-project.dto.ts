import { PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @ApiPropertyOptional({
    description: 'Optional lead name update for the project linked lead',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  leadName?: string;

  @ApiPropertyOptional({
    description: 'Optional lead number update for the project linked lead',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  leadNumber?: string;
}
