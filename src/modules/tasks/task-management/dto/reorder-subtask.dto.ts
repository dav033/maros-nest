import { IsInt, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Reorders a subtask among its parent's other children. Deliberately separate from
 * MoveTaskDto: a subtask has no board column, so `status` has no meaning here — its
 * position is scoped to the parent (see TasksRepository.getSiblingsUnderParent).
 * Omitting both ids sends it to the end.
 */
export class ReorderSubtaskDto {
  @ApiPropertyOptional({ description: 'Insert before this sibling id (same parent)' })
  @IsInt()
  @IsOptional()
  beforeId?: number | null;

  @ApiPropertyOptional({ description: 'Insert after this sibling id (same parent)' })
  @IsInt()
  @IsOptional()
  afterId?: number | null;
}
