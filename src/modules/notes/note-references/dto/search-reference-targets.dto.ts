import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NOTE_REFERENCE_KINDS } from '../../../../entities/note-reference.entity';

/** Query behind the `@` and `[[` menus in the note editor. */
export class SearchReferenceTargetsDto {
  /**
   * Optional, unlike notes search: opening the menu with an empty query has to show
   * something, or `@` looks broken until the first keystroke.
   */
  @ApiPropertyOptional({ description: 'What to match against record names', default: '' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  q?: string = '';

  /**
   * Comma-separated, because it arrives in a URL and `kinds=lead,task` reads better in a
   * log than three repeated parameters. Empty means every kind.
   */
  @ApiPropertyOptional({
    description: 'Comma-separated record kinds to search; omit for all',
    example: 'lead,project,note',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((kind) => kind.trim())
          .filter(Boolean)
      : (value ?? []),
  )
  @IsIn(NOTE_REFERENCE_KINDS, { each: true })
  kinds?: string[] = [];

  /** Per kind, not overall: see NoteReferenceTargetsService.search. */
  @ApiPropertyOptional({ description: 'Max results per kind', default: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  @IsOptional()
  perKind?: number = 5;
}
