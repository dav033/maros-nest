import { IsArray, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetTagsDto {
  @ApiProperty({ description: 'Complete set of tag ids for this page', type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  tagIds: number[];
}
