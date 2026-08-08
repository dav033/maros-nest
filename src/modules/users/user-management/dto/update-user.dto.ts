import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Id of the role to assign' })
  @IsInt()
  @IsOptional()
  roleId?: number;

  @ApiPropertyOptional({
    description:
      'Deactivating revokes access on the next request, no re-login needed',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
