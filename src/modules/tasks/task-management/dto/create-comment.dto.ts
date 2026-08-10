import { IsDefined, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ description: 'Comment body as TipTap document JSON' })
  @IsDefined()
  @IsObject()
  body: Record<string, unknown>;
}
