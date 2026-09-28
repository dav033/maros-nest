import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class CheckInvitationDto {
  @ApiProperty({ description: 'The Google account that just authenticated' })
  @IsEmail()
  email: string;
}
