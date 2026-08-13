import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemoveAttachmentDto {
  @ApiProperty({ description: 'S3 key to remove — a body field, not a path param, since keys contain slashes' })
  @IsString()
  key: string;
}
