import { ArrayMinSize, IsArray, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Additive, not a replace — see TasksService.addLabelsToTask. Bulk-tagging 15 tasks "urgent" must never wipe whatever labels each of them already had. */
export class BulkAddLabelsDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  taskIds: number[];

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  labelIds: number[];
}
