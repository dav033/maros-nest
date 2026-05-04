import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RestorationVisitActivityDto {
  @ApiProperty({ description: 'Activity description', type: String })
  @IsString()
  activity: string;

  @ApiPropertyOptional({ description: 'Image ID', type: String })
  @IsString()
  @IsOptional()
  imageId?: string;

  @ApiPropertyOptional({ description: 'Image file', type: String })
  @IsString()
  @IsOptional()
  imageFile?: string;
}

