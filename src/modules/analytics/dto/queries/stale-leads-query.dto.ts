import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class StaleLeadsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '"days" must be an integer' })
  @Min(1)
  @Max(3650)
  days?: number;
}
