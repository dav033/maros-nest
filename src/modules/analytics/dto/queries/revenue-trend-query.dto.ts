import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DateRangeQueryDto } from './date-range-query.dto';

export class RevenueTrendQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '"months" must be an integer' })
  @Min(1)
  @Max(24)
  months?: number;
}
