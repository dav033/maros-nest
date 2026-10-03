import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { QboCounterpartyType } from '../entities/invoice-scan.entity';

/** The vocabulary of `extracted_data.direction`, which the form already holds. */
export type InvoiceMoneyDirection = 'outgoing' | 'incoming' | 'unknown';

export class CreateQboCounterpartyDto {
  /**
   * 150 characters, the width of `companies.name`. The counterparty is created
   * in QuickBooks *and* in the CRM and QuickBooks cannot undo a create, so a
   * name only one of the two accepts would leave the pair half made.
   */
  @ApiProperty({ description: 'Display name of the vendor or customer', maxLength: 150 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({
    description: 'Direction of the money, used to decide vendor vs customer',
    enum: ['outgoing', 'incoming', 'unknown'],
  })
  @IsIn(['outgoing', 'incoming', 'unknown'])
  @IsOptional()
  direction?: InvoiceMoneyDirection;

  @ApiPropertyOptional({
    description: 'Forces the record type instead of deducing it from the direction',
    enum: ['Vendor', 'Customer'],
  })
  @IsIn(['Vendor', 'Customer'])
  @IsOptional()
  type?: QboCounterpartyType;
}
