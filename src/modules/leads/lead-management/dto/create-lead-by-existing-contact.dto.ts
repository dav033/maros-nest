import { IsNotEmpty, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateLeadDto } from './create-lead.dto';

export class CreateLeadByExistingContactDto {
  @ApiProperty({ description: 'Lead data', type: CreateLeadDto })
  @ValidateNested()
  @Type(() => CreateLeadDto)
  @IsNotEmpty()
  lead: CreateLeadDto;

  @ApiProperty({ description: 'Existing contact ID' })
  @IsNumber()
  @IsNotEmpty()
  contactId: number;
}
