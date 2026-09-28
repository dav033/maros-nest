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
  @ApiProperty({ example: 'client@example.com' })
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

  @ApiProperty({ enum: ['internal', 'client'] })
  @IsIn(['internal', 'client'])
  userType: UserType;

  @ApiPropertyOptional({
    description:
      'Company this client belongs to. Stored and returned, not enforced yet',
  })
  @IsInt()
  @IsOptional()
  scopedCompanyId?: number;

  @ApiPropertyOptional({ description: 'Contact this client belongs to' })
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
