import { IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CreateLeadDto } from './create-lead.dto';
import { CreateContactDto } from '../../contacts/dto/create-contact.dto';

export class CreateLeadByNewContactDto {
  @ApiProperty({ description: 'Lead data', type: CreateLeadDto })
  @ValidateNested()
  @Type(() => CreateLeadDto)
  @IsNotEmpty()
  lead: CreateLeadDto;

  @ApiProperty({ description: 'New contact data', type: CreateContactDto })
  @ValidateNested()
  @Type(() => CreateContactDto)
  @IsNotEmpty()
  contact: CreateContactDto;
}
