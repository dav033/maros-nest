import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetFavoriteDto {
  @ApiProperty({ description: 'Whether the page is marked as favorite' })
  @IsBoolean()
  isFavorite: boolean;
}
