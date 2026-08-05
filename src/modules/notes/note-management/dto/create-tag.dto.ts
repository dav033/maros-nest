import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const NOTE_TAG_COLORS = [
  'neutral',
  'blue',
  'indigo',
  'amber',
  'orange',
  'green',
  'violet',
  'red',
] as const;
export type NoteTagColor = (typeof NOTE_TAG_COLORS)[number];

export class CreateTagDto {
  @ApiProperty({ description: 'Tag name', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ description: 'Badge color token', enum: NOTE_TAG_COLORS, default: 'neutral' })
  @IsIn(NOTE_TAG_COLORS)
  @IsOptional()
  color?: NoteTagColor;
}
