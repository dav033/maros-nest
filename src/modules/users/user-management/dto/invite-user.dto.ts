import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { UserType } from '../../../../entities/user.entity';

export class InviteUserDto {
  @ApiProperty({ example: 'external@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'Shown in the invitation email' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiProperty({ description: 'Id of the role to assign, from GET /roles' })
  @IsInt()
  roleId: number;

  @ApiProperty({ enum: ['internal', 'external'] })
  @IsIn(['internal', 'external'])
  userType: UserType;

  @ApiPropertyOptional({
    description:
      'Company this external user belongs to. Stored and returned, not enforced yet',
  })
  @IsInt()
  @IsOptional()
  scopedCompanyId?: number;

  @ApiPropertyOptional({ description: 'Contact this external user belongs to' })
  @IsInt()
  @IsOptional()
  scopedContactId?: number;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90 })
  @IsInt()
  @Min(1)
  @Max(90)
  @IsOptional()
  expiresInDays?: number;
}
