import { IsInt, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetAssigneeDto {
  @ApiProperty({ description: 'User id to assign, or null to unassign', nullable: true })
  @ValidateIf((dto: SetAssigneeDto) => dto.userId !== null)
  @IsInt()
  userId: number | null;
}
