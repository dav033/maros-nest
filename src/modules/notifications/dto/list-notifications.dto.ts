import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListNotificationsDto {
  @ApiPropertyOptional({ description: 'Only unread notifications', default: false })
  // Implicit conversion (enableImplicitConversion in main.ts) runs before this
  // decorator and turns any non-empty query string into `true` via Boolean(value)
  // — including the literal "false" — so ?unreadOnly=false silently filtered to
  // unread-only. Read the raw value off `obj` (pre-coercion) instead of `value`.
  @Transform(({ obj }) => (obj.unreadOnly === undefined ? undefined : obj.unreadOnly === true || obj.unreadOnly === 'true'))
  @IsBoolean()
  @IsOptional()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ description: 'Max results', default: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
