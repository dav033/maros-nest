import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class N8nProjectPaymentDto {
  @ApiPropertyOptional({ description: 'Payment transaction id', example: '9732' })
  id?: string;

  @ApiPropertyOptional({ description: 'Payment date', example: '2026-05-01' })
  date?: string;

  @ApiProperty({ description: 'Payment amount', example: 1800.5 })
  amount: number;

  @ApiPropertyOptional({ description: 'Payment method', example: 'Credit Card' })
  method?: string;

  @ApiPropertyOptional({ description: 'Payment reference/number', example: 'PMT-2281' })
  reference?: string;

  @ApiPropertyOptional({ description: 'Linked invoice number', example: 'INV-1021' })
  linkedInvoice?: string;
}

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

  @ApiPropertyOptional({
    description: 'Optional payment transactions list from QuickBooks',
    type: [N8nProjectPaymentDto],
  })
  payments?: N8nProjectPaymentDto[];
}






