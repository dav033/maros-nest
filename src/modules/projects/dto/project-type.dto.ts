import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProjectTypeDto {
  @ApiPropertyOptional({ description: 'ID of the project type' })
  @IsOptional()
  id?: number;

  @ApiPropertyOptional({ description: 'Name of the project type' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Color code' })
  @IsString()
  @IsOptional()
  color?: string;
}
