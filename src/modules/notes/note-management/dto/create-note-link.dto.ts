import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateNoteLinkDto {
  @ApiPropertyOptional({
    description: 'Require this password before the note is shown. Omit for an open link',
    minLength: 6,
  })
  @IsString()
  @IsOptional()
  @MinLength(6)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({
    description: 'Serve the page subtree too. Publishing a folder covers everything in it',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  includeChildren?: boolean;

  @ApiPropertyOptional({
    description:
      'Let search engines index the page. Off by default — a published quote has no ' +
      'business ranking in Google',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  allowIndexing?: boolean;

  @ApiPropertyOptional({ description: 'Show who last edited the note', default: true })
  @IsBoolean()
  @IsOptional()
  showAuthor?: boolean;

  @ApiPropertyOptional({ description: 'ISO 8601. Omit for a link that never expires' })
  @IsISO8601()
  @IsOptional()
  expiresAt?: string;
}
