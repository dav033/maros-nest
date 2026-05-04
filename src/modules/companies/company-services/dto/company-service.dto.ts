import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompanyServiceDto {
  @ApiPropertyOptional({ description: 'ID of the service' })
  @IsOptional()
  id?: number;

  @ApiProperty({ description: 'Name of the service', uniqueItems: true })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Color code' })
  @IsString()
  @IsOptional()
  color?: string;
}
