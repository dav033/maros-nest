import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetContactByNameDto {
  @ApiProperty({ description: 'Contact name to search for' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
