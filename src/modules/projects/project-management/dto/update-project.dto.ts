import { PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @ApiPropertyOptional({
    description: 'Optional lead name update for the project linked lead',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  leadName?: string;

  @ApiPropertyOptional({
    description: 'Optional lead number update for the project linked lead',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  leadNumber?: string;

  /**
   * Lo que se espera que el proyecto acabe costando en materiales y en
   * subcontratistas. `null` borra el pronostico, que no es lo mismo que
   * ponerlo a 0: 0 es "no espero gastar nada".
   *
   * El limite inferior se valida aqui y no en la base de datos a proposito: un
   * CHECK saldria como un 500 en el formulario en vez de como un mensaje al
   * lado del campo.
   */
  @ApiPropertyOptional({
    description:
      'Expected final cost in construction materials (QuickBooks account 50400). null clears it.',
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  forecastMaterialCost?: number | null;

  @ApiPropertyOptional({
    description:
      'Expected final cost in subcontractors (QuickBooks account 53600). null clears it.',
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  forecastSubcontractorCost?: number | null;
}
