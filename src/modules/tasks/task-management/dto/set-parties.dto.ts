import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TASK_PARTY_KINDS } from '../../../../entities/task-party.entity';
import type { TaskPartyKind } from '../../../../entities/task-party.entity';

export class TaskPartyInputDto {
  @ApiProperty({ enum: TASK_PARTY_KINDS })
  @IsIn(TASK_PARTY_KINDS)
  partyKind: TaskPartyKind;

  @ApiProperty()
  @IsInt()
  partyId: number;

  @ApiProperty({ required: false, default: 'related' })
  @IsString()
  @MaxLength(40)
  @IsOptional()
  role?: string;
}

export class SetTaskPartiesDto {
  @ApiProperty({ type: [TaskPartyInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskPartyInputDto)
  parties: TaskPartyInputDto[];
}
