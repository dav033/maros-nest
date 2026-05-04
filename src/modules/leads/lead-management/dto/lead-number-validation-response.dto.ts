import { ApiProperty } from '@nestjs/swagger';

export class LeadNumberValidationResponseDto {
  @ApiProperty({ description: 'Whether the lead number is valid/available' })
  valid: boolean;

  @ApiProperty({ description: 'Reason for validation result' })
  reason: string;
}
