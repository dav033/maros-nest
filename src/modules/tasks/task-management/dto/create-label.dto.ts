import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const TASK_LABEL_COLORS = [
  'neutral',
  'blue',
  'sky',
  'indigo',
  'amber',
  'orange',
  'green',
  'violet',
  'red',
] as const;
export type TaskLabelColor = (typeof TASK_LABEL_COLORS)[number];

export class CreateLabelDto {
  @ApiProperty({ description: 'Label name', maxLength: 50 })
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ description: 'Badge color token', enum: TASK_LABEL_COLORS, default: 'neutral' })
  @IsIn(TASK_LABEL_COLORS)
  @IsOptional()
  color?: TaskLabelColor;
}
