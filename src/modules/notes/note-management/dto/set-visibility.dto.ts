import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { NotePageVisibility } from '../../../../entities/note-page.entity';

export const NOTE_VISIBILITIES = ['private', 'team'] as const;

export class SetVisibilityDto {
  @ApiProperty({
    enum: NOTE_VISIBILITIES,
    description:
      'private: only the owner and people it is explicitly shared with. ' +
      'team: anyone with notes:read. Publishing to the web is a separate action — ' +
      'it lives on the share link, not here.',
  })
  @IsIn(NOTE_VISIBILITIES)
  visibility: NotePageVisibility;
}
