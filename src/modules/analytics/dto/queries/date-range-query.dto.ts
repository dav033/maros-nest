import { IsOptional, Matches } from 'class-validator';
import { LeadTypeQueryDto } from './lead-type-query.dto';

export class DateRangeQueryDto extends LeadTypeQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '"from" must be in YYYY-MM-DD format' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '"to" must be in YYYY-MM-DD format' })
  to?: string;
}
