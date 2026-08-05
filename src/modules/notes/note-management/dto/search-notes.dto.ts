import { IsString, IsOptional, IsInt, Min, Max, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchNotesDto {
  @ApiProperty({ description: 'Search query (matched against title and content)' })
  @IsString()
  @MinLength(1)
  q: string;

  @ApiPropertyOptional({ description: 'Max results', default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}
