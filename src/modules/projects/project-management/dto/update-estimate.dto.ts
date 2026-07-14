import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateEstimateDto {
  @ApiProperty({
    description:
      'Nuevo total del estimate del proyecto (lo que se ve en la UI = suma de todos los estimates). Se sincroniza con QuickBooks ajustando el estimate más reciente para que la suma total quede igual a este importe.',
    example: 12500,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;
}
