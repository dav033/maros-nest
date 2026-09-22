import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateInvoiceScanDto {
  /** Project number (the lead number). Empty or null clears it. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  projectNumber?: string | null;
}
