import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderAttachmentsDto {
  @ApiProperty({
    description:
      'Desired display order of S3 keys. Reconciled against the server\'s current set — ' +
      'keys missing here (added concurrently) are appended, keys present here but no ' +
      'longer on the server (removed concurrently) are dropped. See TasksService.reorderAttachments.',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  keys: string[];
}
