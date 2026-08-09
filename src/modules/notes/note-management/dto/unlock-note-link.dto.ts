import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UnlockNoteLinkDto {
  /**
   * No MinLength here even though creation enforces one: rejecting a short attempt
   * before checking it would tell an attacker the password is at least six characters.
   */
  @ApiProperty({ description: 'The password set on this share link' })
  @IsString()
  @MaxLength(128)
  password: string;
}
