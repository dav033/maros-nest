import { Injectable } from '@nestjs/common';
import { RestorationVisitDto } from '../dto/restoration-visit.dto';
import { RestorationVisitUrlResponseDto } from '../dto/restoration-visit-url-response.dto';

@Injectable()
export class ReportsService {
  private readonly BASE_URL = 'https://maros-app.netlify.app/reports/restoration-visit';

  generateRestorationVisitUrl(data: RestorationVisitDto): RestorationVisitUrlResponseDto {
    const jsonString = JSON.stringify(data);
    const base64Data = Buffer.from(jsonString).toString('base64');
    const url = `${this.BASE_URL}?data=${base64Data}`;
    
    return { url };
  }
}

