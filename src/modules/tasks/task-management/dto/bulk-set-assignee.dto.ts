import { ArrayMinSize, IsArray, IsInt, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BulkSetAssigneeDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  taskIds: number[];

  @ApiProperty({ description: 'User id to assign every selected task to, or null to unassign', nullable: true })
  @ValidateIf((dto: BulkSetAssigneeDto) => dto.userId !== null)
  @IsInt()
  userId: number | null;
}
