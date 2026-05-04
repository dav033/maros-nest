import { IsNumber, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateLeadDto } from './create-lead.dto';

export class CreateLeadExistingContactDto {
  @ApiProperty({ description: 'Lead information' })
  @ValidateNested()
  @Type(() => CreateLeadDto)
  @IsNotEmpty()
  lead: CreateLeadDto;

  @ApiProperty({ description: 'ID of the existing contact' })
  @IsNumber()
  @IsNotEmpty()
  contactId: number;
}
