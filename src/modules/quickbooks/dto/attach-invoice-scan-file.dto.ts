import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Adjuntar un documento a un registro que ya existe: la transacción manual se
 * guarda primero con los valores escritos a mano y el archivo es opcional, así
 * que llega en una segunda llamada.
 */
export class AttachInvoiceScanFileDto {
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
