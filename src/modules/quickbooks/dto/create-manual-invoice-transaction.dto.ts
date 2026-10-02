import {
  IsIn,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateManualInvoiceTransactionDto {
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  description: string;

  @IsIn(['payment_made', 'payment_received'])
  direction: 'payment_made' | 'payment_received';

  @IsString()
  @IsDateString({ strict: true })
  transactionDate: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  counterpartyName?: string | null;

  /** Only when the name came from the QuickBooks list; free text sends neither. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  counterpartyId?: string | null;

  @IsOptional()
  @IsIn(['Vendor', 'Customer'])
  counterpartyType?: 'Vendor' | 'Customer' | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  projectNumber?: string | null;
}
