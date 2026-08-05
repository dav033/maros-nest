import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateNoteDto {
  @ApiPropertyOptional({ description: 'Page title', maxLength: 255 })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Icon (emoji or lucide icon name)', maxLength: 50 })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  icon?: string;
}
