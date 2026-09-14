import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateInvoiceScanDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes: number;
}
