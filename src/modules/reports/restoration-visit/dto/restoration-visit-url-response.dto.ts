import { ApiProperty } from '@nestjs/swagger';

export class RestorationVisitUrlResponseDto {
  @ApiProperty({ 
    description: 'URL with encoded data', 
    type: String,
    example: 'https://maros-app.netlify.app/reports/restoration-visit?data=eyJ...'
  })
  url: string;
}

