import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LinkQuickbooksJobDto {
  @ApiProperty({
    description:
      'Id del job (Customer con Job = true) de QuickBooks que se enlaza con este proyecto del CRM.',
    example: '512',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  qboCustomerId: string;
}
