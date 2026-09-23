import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class InvoiceLineItemDto {
  @IsString()
  @MaxLength(500)
  description: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number | null;
}

/**
 * Everything a reviewer may correct on a scan. Every field is optional; `null`
 * clears it. Only fields present in the body are touched.
 */
export class UpdateInvoiceScanDto {
  /** Project number (the lead number). Empty or null clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  projectNumber?: string | null;

  @IsOptional()
  @IsIn(['outgoing', 'incoming', 'unknown'])
  direction?: 'outgoing' | 'incoming' | 'unknown';

  @IsOptional()
  @IsIn(['customer_service', 'materials_expense', 'subcontractor_expense', 'other', 'unknown'])
  classification?:
    | 'customer_service'
    | 'materials_expense'
    | 'subcontractor_expense'
    | 'other'
    | 'unknown';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  counterpartyName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceNumber?: string | null;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'issueDate must be YYYY-MM-DD' })
  issueDate?: string | null;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string | null;

  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  subtotal?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxTotal?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  total?: number | null;

  @IsOptional()
  @IsIn(['paid', 'unpaid', 'unknown'])
  paymentStatus?: 'paid' | 'unpaid' | 'unknown';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineItemDto)
  lineItems?: InvoiceLineItemDto[];

  /** true = entered in QuickBooks (moves to the completed table); false = back to pending. */
  @IsOptional()
  @IsBoolean()
  entered?: boolean;
}
