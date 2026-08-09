import { IsIn, IsInt, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NOTE_ENTITY_KINDS, NoteEntityKind } from './create-note.dto';

/**
 * Links a note to a CRM entity, or clears the link when both fields are null.
 * They travel together: a kind without an id (or the reverse) is meaningless.
 */
export class SetEntityDto {
  @ApiProperty({
    description: 'CRM entity kind, or null to unlink',
    enum: NOTE_ENTITY_KINDS,
    nullable: true,
  })
  @ValidateIf((dto: SetEntityDto) => dto.entityKind !== null)
  @IsIn(NOTE_ENTITY_KINDS)
  entityKind: NoteEntityKind | null;

  @ApiProperty({ description: 'CRM entity id, or null to unlink', nullable: true })
  @ValidateIf((dto: SetEntityDto) => dto.entityKind !== null)
  @IsInt()
  entityId: number | null;
}
