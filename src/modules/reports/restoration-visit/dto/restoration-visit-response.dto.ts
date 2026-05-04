import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RestorationVisitResponseDto {
  @ApiProperty({ description: 'Lead number', type: String })
  leadNumber?: string;

  @ApiPropertyOptional({ description: 'Project number', type: String })
  projectNumber?: string;

  @ApiPropertyOptional({ description: 'Project name', type: String })
  projectName?: string;

  @ApiPropertyOptional({ description: 'Project location', type: String })
  projectLocation?: string;

  @ApiPropertyOptional({ description: 'Client name', type: String })
  clientName?: string;

  @ApiPropertyOptional({ description: 'Client type', type: String })
  clientType?: string;

  @ApiPropertyOptional({ description: 'Customer name', type: String })
  customerName?: string;

  @ApiPropertyOptional({ description: 'Email', type: String })
  email?: string;

  @ApiPropertyOptional({ description: 'Phone', type: String })
  phone?: string;

  @ApiPropertyOptional({ description: 'Date started', type: String })
  dateStarted?: string;

  @ApiPropertyOptional({ description: 'Overview', type: String })
  overview?: string;

  @ApiProperty({ description: 'Language', type: String })
  language?: string;

  @ApiPropertyOptional({
    description: 'Activities',
    type: Array,
    example: [{ activity: 'Activity description', imageUrls: [] }],
  })
  activities?: Array<{ activity?: string; imageUrls?: string[] }>;

  @ApiPropertyOptional({
    description: 'Additional activities',
    type: Array,
    example: [{ activity: 'Additional activity', imageUrls: [] }],
  })
  additionalActivities?: Array<{ activity?: string; imageUrls?: string[] }>;

  @ApiPropertyOptional({
    description: 'Next activities',
    type: [String],
    example: ['Next activity 1', 'Next activity 2'],
  })
  nextActivities?: string[];

  @ApiPropertyOptional({
    description: 'Observations',
    type: [String],
    example: ['Observation 1', 'Observation 2'],
  })
  observations?: string[];
}


