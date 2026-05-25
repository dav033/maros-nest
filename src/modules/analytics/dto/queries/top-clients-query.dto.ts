import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export type TopClientsSortBy = 'revenue' | 'volume';

export class TopClientsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '"limit" must be an integer' })
  @Min(1)
  @Max(20)
  limit?: number;

  @IsOptional()
  @IsIn(['revenue', 'volume'], { message: '"by" must be "revenue" or "volume"' })
  by?: TopClientsSortBy;
}
