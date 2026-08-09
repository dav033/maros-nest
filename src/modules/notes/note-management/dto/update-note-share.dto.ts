import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, ValidateIf } from 'class-validator';
import type { NoteShareAccess } from '../../../../entities/note-page-share.entity';
import { NOTE_SHARE_ACCESS_LEVELS } from './create-note-share.dto';

export class UpdateNoteShareDto {
  @ApiPropertyOptional({ enum: NOTE_SHARE_ACCESS_LEVELS })
  @IsIn(NOTE_SHARE_ACCESS_LEVELS)
  @IsOptional()
  access?: NoteShareAccess;

  /**
   * Explicit `null` clears the expiry; omitting the field leaves it alone. The
   * ValidateIf skips the ISO check for that null, which IsOptional alone would not do —
   * IsOptional treats null as "absent" and would swallow a deliberate clear.
   */
  @ApiPropertyOptional({ description: 'ISO 8601, or null to remove the expiry' })
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  @IsOptional()
  expiresAt?: string | null;
}
