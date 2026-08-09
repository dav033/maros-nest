import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional } from 'class-validator';
import type {
  NoteShareAccess,
  NoteShareSubjectType,
} from '../../../../entities/note-page-share.entity';

export const NOTE_SHARE_SUBJECT_TYPES = ['user', 'role'] as const;
export const NOTE_SHARE_ACCESS_LEVELS = ['viewer', 'commenter', 'editor'] as const;

export class CreateNoteShareDto {
  @ApiProperty({
    enum: NOTE_SHARE_SUBJECT_TYPES,
    description: 'Grant to one person, or to everyone holding a role',
  })
  @IsIn(NOTE_SHARE_SUBJECT_TYPES)
  subjectType: NoteShareSubjectType;

  @ApiProperty({ description: 'users.id or roles.id, per subjectType' })
  @IsInt()
  subjectId: number;

  @ApiProperty({
    enum: NOTE_SHARE_ACCESS_LEVELS,
    description:
      'commenter is accepted and stored, but behaves as viewer until the comments UI ships',
  })
  @IsIn(NOTE_SHARE_ACCESS_LEVELS)
  access: NoteShareAccess;

  @ApiPropertyOptional({ description: 'ISO 8601. Omit for a grant that does not expire' })
  @IsISO8601()
  @IsOptional()
  expiresAt?: string;
}
