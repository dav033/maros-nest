import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateNoteLinkDto {
  /**
   * Three-state on purpose: a string sets a new password, explicit `null` removes the
   * one that was there, and omitting the field keeps the current one. Collapsing null
   * and undefined would make "remove password" impossible to express.
   */
  @ApiPropertyOptional({ description: 'New password, or null to remove it', minLength: 6 })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsOptional()
  @MinLength(6)
  @MaxLength(128)
  password?: string | null;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  includeChildren?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  allowIndexing?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  showAuthor?: boolean;

  @ApiPropertyOptional({ description: 'ISO 8601, or null to remove the expiry' })
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  @IsOptional()
  expiresAt?: string | null;
}
