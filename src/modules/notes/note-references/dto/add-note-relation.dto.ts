import { IsIn, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NOTE_REFERENCE_KINDS } from '../../../../entities/note-reference.entity';

/** Pins one record to a note's header. The pair always travels together. */
export class AddNoteRelationDto {
  @ApiProperty({ description: 'Kind of record to relate', enum: NOTE_REFERENCE_KINDS })
  @IsIn(NOTE_REFERENCE_KINDS)
  kind: string;

  @ApiProperty({ description: 'Id of the record to relate' })
  @IsInt()
  @Min(1)
  targetId: number;
}
