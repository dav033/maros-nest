import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestNoteAccessDto {
  @ApiPropertyOptional({ description: 'Why you need access', maxLength: 500 })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  message?: string;
}
