import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClickUpStatusDto {
  @ApiProperty({ description: 'Status name' })
  status: string;

  @ApiProperty({ description: 'Status color' })
  color: string;

  @ApiProperty({ description: 'Order index' })
  orderindex: number;

  @ApiProperty({ description: 'Status type' })
  type: string;
}

export class ClickUpTaskResponseDto {
  @ApiProperty({ description: 'Task ID' })
  id: string;

  @ApiProperty({ description: 'Task name' })
  name: string;

  @ApiPropertyOptional({ description: 'Task description' })
  description?: string;

  @ApiPropertyOptional({ description: 'Task status' })
  status?: ClickUpStatusDto;

  @ApiPropertyOptional({ description: 'Task URL' })
  url?: string;

  @ApiPropertyOptional({ description: 'Date created' })
  date_created?: string;

  @ApiPropertyOptional({ description: 'Date updated' })
  date_updated?: string;
}
