import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CompanyServicesService } from './services/company-services.service';
import { CreateCompanyServiceDto } from './dto/create-company-service.dto';
import { UpdateCompanyServiceDto } from './dto/update-company-service.dto';

@ApiTags('company-services')
@Controller('company-services')
export class CompanyServicesController {
  constructor(private readonly companyServicesService: CompanyServicesService) {}

  @Get('all')
  @ApiOperation({ summary: 'Get all company services' })
  @ApiResponse({ status: 200, description: 'Returns all company services' })
  async getAll() {
    return this.companyServicesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get company service by ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the company service' })
  @ApiResponse({ status: 404, description: 'Company service not found' })
  async getById(@Param('id', ParseIntPipe) id: number) {
    return this.companyServicesService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create company service' })
  @ApiResponse({ status: 200, description: 'Company service created successfully' })
  async create(@Body() dto: CreateCompanyServiceDto) {
    return this.companyServicesService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update company service' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Company service updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Company service not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCompanyServiceDto,
  ) {
    // Validate that if dto.id is provided, it matches the path parameter
    if ((dto as any).id !== undefined && (dto as any).id !== id) {
      throw new BadRequestException('ID mismatch');
    }
    
    // Remove id from DTO to prevent updates
    const { id: _, ...serviceData } = dto as any;
    
    return this.companyServicesService.update(id, serviceData);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete company service' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Company service deleted successfully' })
  @ApiResponse({ status: 404, description: 'Company service not found' })
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.companyServicesService.delete(id);
  }
}
