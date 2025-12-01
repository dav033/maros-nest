import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LeadType } from '../../../common/enums/lead-type.enum';

export class GetLeadsByTypeDto {
  @ApiProperty({ 
    description: 'Lead type to filter by',
    enum: LeadType,
    example: LeadType.CONSTRUCTION
  })
  @IsEnum(LeadType)
  @IsNotEmpty()
  type: LeadType;
}
