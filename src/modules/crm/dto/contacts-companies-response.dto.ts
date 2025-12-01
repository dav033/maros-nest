import { ApiProperty } from '@nestjs/swagger';

export class ContactsCompaniesResponseDto {
  @ApiProperty({ description: 'List of contacts', type: 'array' })
  contacts: any[];

  @ApiProperty({ description: 'List of companies', type: 'array' })
  companies: any[];
}
