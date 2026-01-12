import { ApiProperty } from '@nestjs/swagger';

export class N8nProjectFinancialRequestDto {
  @ApiProperty({
    description: 'Array of project numbers to get financial information for',
    example: ['001-0924', '009-1224', '001R-0625'],
    type: [String],
  })
  projectNumbers: string[];
}






