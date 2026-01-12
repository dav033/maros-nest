import { ApiProperty } from '@nestjs/swagger';

export class N8nProjectFinancialResponseDto {
  @ApiProperty({
    description: 'Project number',
    example: '001-0924',
  })
  projectNumber: string;

  @ApiProperty({
    description: 'Estimated amount',
    example: 75244,
  })
  estimatedAmount: number;

  @ApiProperty({
    description: 'Number of estimates',
    example: 1,
  })
  estimateCount: number;

  @ApiProperty({
    description: 'Invoiced amount',
    example: 75701.3,
  })
  invoicedAmount: number;

  @ApiProperty({
    description: 'Number of invoices',
    example: 2,
  })
  invoiceCount: number;

  @ApiProperty({
    description: 'Paid amount',
    example: 45991.46,
  })
  paidAmount: number;

  @ApiProperty({
    description: 'Outstanding amount',
    example: 29709.84,
  })
  outstandingAmount: number;

  @ApiProperty({
    description: 'Paid percentage',
    example: 60.75,
  })
  paidPercentage: number;

  @ApiProperty({
    description: 'Difference between estimated and invoiced amount',
    example: -457.3,
  })
  estimateVsInvoicedDelta: number;
}






