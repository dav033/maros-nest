import { IsInt, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MoveNoteDto {
  @ApiPropertyOptional({ description: 'New parent id, or null to move to the root' })
  @IsInt()
  @IsOptional()
  parentId?: number | null;

  @ApiPropertyOptional({ description: 'Insert before this sibling id' })
  @IsInt()
  @IsOptional()
  beforeId?: number | null;

  @ApiPropertyOptional({ description: 'Insert after this sibling id' })
  @IsInt()
  @IsOptional()
  afterId?: number | null;
}
