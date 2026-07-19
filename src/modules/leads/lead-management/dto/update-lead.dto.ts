import { Type } from 'class-transformer';
import { IsDefined, IsObject, ValidateNested } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateLeadDto } from './create-lead.dto';

export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

export class UpdateLeadRequestDto {
  @ApiProperty({ type: UpdateLeadDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateLeadDto)
  lead: UpdateLeadDto;
}
