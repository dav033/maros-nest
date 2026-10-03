import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * QuickBooks no borra un Customer: lo unico que se puede hacer es ponerle
 * `Active: false`. Por eso el DTO habla de desactivar y nunca de eliminar.
 *
 * `confirm` viaja en el cuerpo a proposito, igual que en `delete_invoice_scan`:
 * esto escribe en la contabilidad, y una llamada mal interpretada no debe poder
 * dispararlo. La regla de negocio se vuelve a comprobar en el servicio, que es
 * donde entra tambien un llamador interno sin ValidationPipe delante.
 */
export class DeactivateQuickbooksJobDto {
  @ApiProperty({
    description:
      'Id del job (Customer con Job = true) de QuickBooks que se va a desactivar.',
    example: '512',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  qboCustomerId: string;

  @ApiProperty({
    description:
      'Debe ser exactamente true. Confirma que se desactiva el job en la contabilidad.',
    example: true,
  })
  @Equals(true)
  confirm: boolean;
}
