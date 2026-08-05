import { IsDefined, IsObject, IsDateString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateNoteContentDto {
  @ApiProperty({ description: 'TipTap document JSON' })
  @IsDefined()
  @IsObject()
  content: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'updatedAt the client last saw. If provided and it no longer matches the ' +
      'stored value, the save is rejected as stale (409) instead of silently overwriting ' +
      'a newer edit from another tab.',
  })
  @IsDateString()
  @IsOptional()
  expectedUpdatedAt?: string;
}
