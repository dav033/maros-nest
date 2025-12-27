import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { RestorationVisitDto } from '../dto/restoration-visit.dto';
import { RestorationVisitUrlResponseDto } from '../dto/restoration-visit-url-response.dto';
import { RestorationVisitResponseDto } from '../dto/restoration-visit-response.dto';
import { ProjectsService } from '../../projects/services/projects.service';

@Injectable()
export class ReportsService {
  private readonly BASE_URL = 'https://maros-app.netlify.app/reports/restoration-visit';
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly projectsService: ProjectsService,
  ) {}

  generateRestorationVisitUrl(data: RestorationVisitDto): RestorationVisitUrlResponseDto {
    const jsonString = JSON.stringify(data);
    const base64Data = Buffer.from(jsonString).toString('base64');
    const url = `${this.BASE_URL}?data=${base64Data}`;
    
    return { url };
  }

  async getRestorationVisitFromBase64(base64Data: string): Promise<RestorationVisitResponseDto> {
    try {
      const decodedString = Buffer.from(base64Data, 'base64').toString('utf-8');
      const decodedData: RestorationVisitDto = JSON.parse(decodedString);

      if (!decodedData.lead_number) {
        throw new BadRequestException('lead_number is required in the decoded data');
      }

      const project = await this.projectsService.findByLeadNumber(decodedData.lead_number);
      
      if (!project) {
        throw new NotFoundException(`Project not found for lead number: ${decodedData.lead_number}`);
      }

      const lead = project.lead;
      const contact = lead?.contact;
      const company = contact?.company;

      const clientType = company ? 'company' : 'individual';
      const clientName = company?.name || (contact?.isClient ? contact.name : '');
      const customerName = contact?.isCustomer ? contact.name : contact?.name || '';

      const response: RestorationVisitResponseDto = {
        leadNumber: decodedData.lead_number,
        projectNumber: lead?.leadNumber || decodedData.lead_number,
        projectName: lead?.name || project.overview || '',
        projectLocation: lead?.location || '',
        clientName: clientName,
        clientType: clientType,
        customerName: customerName,
        email: contact?.email || '',
        phone: contact?.phone || '',
        dateStarted: lead?.startDate || '',
        overview: project.overview || '',
        language: decodedData.language || 'en',
        activities: decodedData.activities?.map((act) => ({
          activity: act.activity || '',
          imageUrls: [],
        })) || [],
        additionalActivities: decodedData.additional_activities?.map((act) => ({
          activity: act.activity || '',
          imageUrls: [],
        })) || [],
        nextActivities: decodedData.next_activities || [],
        observations: decodedData.observations || [],
      };

      return response;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new BadRequestException('Invalid base64 data: JSON parse error');
      }
      throw new BadRequestException(`Error processing base64 data: ${error.message}`);
    }
  }

}

