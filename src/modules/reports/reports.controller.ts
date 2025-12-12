import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReportsService } from './services/reports.service';
import { RestorationVisitDto } from './dto/restoration-visit.dto';
import { RestorationVisitUrlResponseDto } from './dto/restoration-visit-url-response.dto';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('restoration-visit/generate-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate restoration visit report URL with base64 encoded data' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the URL with encoded data',
    type: RestorationVisitUrlResponseDto
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async generateRestorationVisitUrl(
    @Body() data: RestorationVisitDto,
  ): Promise<RestorationVisitUrlResponseDto> {
    return this.reportsService.generateRestorationVisitUrl(data);
  }
}

