import { IsArray, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetLabelsDto {
  @ApiProperty({ description: 'Complete set of label ids for this task', type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  labelIds: number[];
}
