import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NOTE_REFERENCE_KINDS,
  NOTE_REFERENCE_ORIGINS,
} from '../../../../entities/note-reference.entity';

/** The reverse question: which notes point at this record. */
export class ListReferencingNotesDto {
  @ApiProperty({ description: 'Kind of the referenced record', enum: NOTE_REFERENCE_KINDS })
  @IsIn(NOTE_REFERENCE_KINDS)
  kind: string;

  @ApiProperty({ description: 'Id of the referenced record' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId: number;

  /**
   * Omitted means both. A record page asks for `inline` to list the notes that merely
   * mention it, because the ones pinned to it are already in its Notes panel and would
   * otherwise be listed twice on the same screen.
   */
  @ApiPropertyOptional({
    description: 'Comma-separated origins to include; omit for both',
    example: 'inline',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      : (value ?? []),
  )
  @IsIn(NOTE_REFERENCE_ORIGINS, { each: true })
  origins?: string[] = [];
}
