import { ApiProperty } from '@nestjs/swagger';

export class ContactValidationResponseDto {
  @ApiProperty({ description: 'Whether the name is available' })
  nameAvailable: boolean;

  @ApiProperty({ description: 'Whether the email is available' })
  emailAvailable: boolean;

  @ApiProperty({ description: 'Whether the phone is available' })
  phoneAvailable: boolean;

  @ApiProperty({ description: 'Reason for name validation result' })
  nameReason: string;

  @ApiProperty({ description: 'Reason for email validation result' })
  emailReason: string;

  @ApiProperty({ description: 'Reason for phone validation result' })
  phoneReason: string;
}
