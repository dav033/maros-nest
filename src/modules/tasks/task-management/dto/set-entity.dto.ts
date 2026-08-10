import { IsIn, IsInt, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TASK_ENTITY_KINDS, TaskEntityKind } from './create-task.dto';

/**
 * Links a task to a CRM entity, or clears the link when both fields are null.
 * They travel together: a kind without an id (or the reverse) is meaningless.
 */
export class SetEntityDto {
  @ApiProperty({
    description: 'CRM entity kind, or null to unlink',
    enum: TASK_ENTITY_KINDS,
    nullable: true,
  })
  @ValidateIf((dto: SetEntityDto) => dto.entityKind !== null)
  @IsIn(TASK_ENTITY_KINDS)
  entityKind: TaskEntityKind | null;

  @ApiProperty({ description: 'CRM entity id, or null to unlink', nullable: true })
  @ValidateIf((dto: SetEntityDto) => dto.entityKind !== null)
  @IsInt()
  entityId: number | null;
}
