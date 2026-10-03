import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
} from 'class-validator';
import { LeadType } from '../../../../common/enums/lead-type.enum';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Id of the role to assign' })
  @IsInt()
  @IsOptional()
  roleId?: number;

  @ApiPropertyOptional({
    description:
      'Deactivating revokes access on the next request, no re-login needed',
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /**
   * Los tipos de lead que este usuario puede ver. `null` quita la restriccion y
   * le devuelve todos.
   *
   * Un array vacio se rechaza: "restringido a ningun tipo" deja una pantalla
   * vacia indistinguible de un fallo, y la forma de decir "ningun lead" es
   * quitarle el permiso de leads. La base lo rechaza tambien con un CHECK, pero
   * aqui el mensaje llega al formulario en vez de como un 500.
   */
  @ApiPropertyOptional({
    description:
      'Lead types this user may see. null removes the restriction. An empty list is rejected.',
    enum: LeadType,
    isArray: true,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(LeadType, { each: true })
  @ArrayNotEmpty()
  @ArrayUnique()
  scopedLeadTypes?: LeadType[] | null;
}
