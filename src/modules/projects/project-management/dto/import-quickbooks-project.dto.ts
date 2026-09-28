import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Una decision de importacion: que job de QuickBooks se vincula y a que numero
 * de proyecto. Las reglas de negocio (numero obligatorio, limite de 50
 * caracteres y que `leadId` y `projectId` se excluyen) viven en
 * `QuickbooksProjectImportService.normalizeDecision`, que las aplica venga la
 * decision del controlador o de una fila de importBatch. Aqui solo se valida la
 * forma de la entrada, que es lo que el ValidationPipe global puede exigir.
 */
export class ImportQuickbooksProjectDto {
  @ApiProperty({ description: 'QuickBooks job (Customer) id to link' })
  @IsString()
  qboCustomerId: string;

  @ApiProperty({ description: 'CRM project number the job is imported under' })
  @IsString()
  projectNumber: string;

  @ApiPropertyOptional({ description: 'Name for the CRM lead created on import' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Location for the CRM lead created on import' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: 'Existing CRM lead to link the job to', type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  leadId?: number;

  @ApiPropertyOptional({ description: 'Existing CRM project to link the job to', type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  projectId?: number;
}
