import {
  IsString,
  IsOptional,
  MaxLength,
  IsInt,
  IsIn,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const NOTE_ENTITY_KINDS = ['lead', 'project', 'contact', 'company'] as const;
export type NoteEntityKind = (typeof NOTE_ENTITY_KINDS)[number];

export class CreateNoteDto {
  @ApiPropertyOptional({ description: 'Page title', maxLength: 255, default: 'Untitled' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Icon (emoji or lucide icon name)', maxLength: 50 })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  icon?: string;

  @ApiPropertyOptional({ description: 'Parent page id, for a nested page' })
  @IsInt()
  @IsOptional()
  parentId?: number;

  @ApiPropertyOptional({ description: 'CRM entity kind this page is linked to', enum: NOTE_ENTITY_KINDS })
  @IsIn(NOTE_ENTITY_KINDS)
  @IsOptional()
  entityKind?: NoteEntityKind;

  @ApiPropertyOptional({ description: 'CRM entity id this page is linked to' })
  @IsInt()
  @IsOptional()
  entityId?: number;
}
