import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendEstimateEmailDto {
  @ApiProperty({
    description: 'Recipient emails',
    type: [String],
  })
  @IsArray()
  @IsEmail({}, { each: true })
  recipients: string[];

  @ApiPropertyOptional({ description: 'Additional CC emails', type: [String] })
  @IsArray()
  @IsEmail({}, { each: true })
  @IsOptional()
  cc?: string[];

  @ApiProperty({ description: 'Whether to attach the estimate file' })
  @IsBoolean()
  includeAttachment: boolean;

  @ApiPropertyOptional({
    description: 'Specific S3 key to attach (defaults to the detected estimate file)',
  })
  @IsString()
  @IsOptional()
  attachmentKey?: string;

  @ApiPropertyOptional({ description: 'Override subject' })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiPropertyOptional({ description: 'Override body message' })
  @IsString()
  @IsOptional()
  message?: string;
}
