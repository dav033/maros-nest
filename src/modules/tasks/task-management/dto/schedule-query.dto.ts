import { IsArray, IsDateString, IsEnum, IsInt, IsOptional } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { toArray } from './toArray.util';
import { LeadType } from '../../../../common/enums/lead-type.enum';

export class ScheduleQueryDto {
  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @Transform(({ value }) => toArray(value)?.map(Number))
  @Type(() => Number)
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  assigneeUserId?: number[];

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  jobId?: number;

  @IsOptional()
  @IsEnum(LeadType)
  leadType?: LeadType;
}
