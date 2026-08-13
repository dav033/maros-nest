import { ArrayMinSize, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddAttachmentsDto {
  @ApiProperty({ description: 'S3 keys to add — already-present keys are ignored', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  keys: string[];
}
