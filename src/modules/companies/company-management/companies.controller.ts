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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CompaniesService } from './services/companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';

@ApiTags('companies')
@Controller('companies')
// Class-level default; write/delete routes override it below.
@RequirePermissions('companies:read')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get('all')
  @ApiOperation({ summary: 'Get all companies' })
  @ApiResponse({ status: 200, description: 'Returns all companies' })
  async getCompanies() {
    return this.companiesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get company by ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the company' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  async getCompanyById(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.findById(id);
  }

  @Post()
  @RequirePermissions('companies:write')
  @ApiOperation({ summary: 'Create company' })
  @ApiResponse({ status: 200, description: 'Company created successfully' })
  async createCompany(@Body() company: CreateCompanyDto) {
    return this.companiesService.create(company);
  }

  @Put(':id')
  @RequirePermissions('companies:write')
  @ApiOperation({ summary: 'Update company' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Company updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  async updateCompany(
    @Param('id', ParseIntPipe) id: number,
    @Body() company: UpdateCompanyDto,
  ) {
    return this.companiesService.update(id, company);
  }

  @Delete(':id')
  @RequirePermissions('companies:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete company' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Company deleted successfully' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  async deleteCompany(@Param('id', ParseIntPipe) id: number) {
    await this.companiesService.delete(id);
  }

  @Post(':id/contacts')
  @RequirePermissions('companies:write')
  @ApiOperation({ summary: 'Assign contacts to company' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Contacts assigned successfully' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  async assignContactsToCompany(
    @Param('id', ParseIntPipe) id: number,
    @Body() contactIds: number[],
  ) {
    await this.companiesService.assignContactsToCompany(id, contactIds);
    return { message: 'Contacts assigned successfully' };
  }
}
