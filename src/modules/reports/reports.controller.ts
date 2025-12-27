import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { ReportsService } from './services/reports.service';
import { RestorationVisitDto } from './dto/restoration-visit.dto';
import { RestorationVisitUrlResponseDto } from './dto/restoration-visit-url-response.dto';
import { RestorationVisitResponseDto } from './dto/restoration-visit-response.dto';

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

  @Get('restoration-visit')
  @ApiOperation({ summary: 'Get restoration visit data from base64 encoded query parameter' })
  @ApiQuery({ 
    name: 'data', 
    type: String, 
    required: true,
    description: 'Base64 encoded restoration visit data'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the restoration visit data with project information',
    type: RestorationVisitResponseDto
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid base64 data' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async getRestorationVisitFromData(
    @Query('data') data: string,
  ): Promise<RestorationVisitResponseDto> {
    if (!data) {
      throw new BadRequestException('data query parameter is required');
    }
    return this.reportsService.getRestorationVisitFromBase64(data);
  }

}

