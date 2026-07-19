import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  ParseEnumPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { CreateLeadByNewContactDto } from './dto/create-lead-by-new-contact.dto';
import { CreateLeadByExistingContactDto } from './dto/create-lead-by-existing-contact.dto';
import { GetLeadsByTypeDto } from './dto/get-leads-by-type.dto';
import { UpdateLeadRequestDto } from './dto/update-lead.dto';
import { LeadNumberValidationResponseDto } from './dto/lead-number-validation-response.dto';
import { LeadType } from '../../../common/enums/lead-type.enum';

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  // Las listas se enriquecen con QBO (financial.estimatedAmount, etc.):
  // el monto estimado de un lead viene 100% de los Estimates de QuickBooks.

  @Get()
  @ApiOperation({ summary: 'Get all leads' })
  @ApiResponse({ status: 200, description: 'Returns all leads' })
  async getAllLeads() {
    return this.leadsService.getAllLeads({ includeQbo: true });
  }

  @Post('type')
  @ApiOperation({ summary: 'Get leads by type (POST with body)' })
  @ApiResponse({ status: 200, description: 'Returns leads filtered by type' })
  async getLeadsByType(@Body() request: GetLeadsByTypeDto) {
    return this.leadsService.getLeadsByType(request.type, { includeQbo: true });
  }

  @Get('type')
  @ApiOperation({ summary: 'Get leads by type (GET with query param)' })
  @ApiQuery({ name: 'type', enum: LeadType })
  @ApiResponse({ status: 200, description: 'Returns leads filtered by type' })
  async getLeadsByTypeGet(
    @Query('type', new ParseEnumPipe(LeadType)) type: LeadType,
  ) {
    return this.leadsService.getLeadsByType(type, { includeQbo: true });
  }

  @Get('review')
  @ApiOperation({ summary: 'Get leads in review' })
  @ApiResponse({ status: 200, description: 'Returns leads with inReview = true' })
  async getLeadsInReview() {
    return this.leadsService.getLeadsInReview({ includeQbo: true });
  }

  @Get('lost')
  @ApiOperation({ summary: 'Get lost leads across all types' })
  @ApiResponse({ status: 200, description: 'Returns leads with status = LOST' })
  async getLostLeads() {
    return this.leadsService.getLostLeads({ includeQbo: true });
  }

  @Post('new-contact')
  @ApiOperation({ summary: 'Create lead with new contact' })
  @ApiQuery({
    name: 'leadType',
    required: false,
    enum: LeadType,
    description: 'Lead type for number generation if leadNumber is not provided'
  })
  @ApiResponse({ status: 200, description: 'Lead created successfully' })
  async createLeadByNewContact(
    @Body() request: CreateLeadByNewContactDto,
    @Query('leadType') leadType?: LeadType,
  ) {
    return this.leadsService.createLeadWithNewContact(
      request.lead,
      request.contact,
      leadType,
    );
  }

  @Post('existing-contact')
  @ApiOperation({ summary: 'Create lead with existing contact' })
  @ApiQuery({
    name: 'leadType',
    required: false,
    enum: LeadType,
    description: 'Lead type for number generation if leadNumber is not provided'
  })
  @ApiResponse({ status: 200, description: 'Lead created successfully' })
  async createLeadByExistingContact(
    @Body() request: CreateLeadByExistingContactDto,
    @Query('leadType') leadType?: LeadType,
  ) {
    return this.leadsService.createLeadWithExistingContact(
      request.lead,
      request.contactId,
      leadType,
    );
  }

  @Get('validate/lead-number')
  @ApiOperation({ summary: 'Validate lead number availability' })
  @ApiQuery({ name: 'leadNumber', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Validation result',
    type: LeadNumberValidationResponseDto
  })
  async validateLeadNumber(
    @Query('leadNumber') leadNumber: string,
  ): Promise<LeadNumberValidationResponseDto> {
    return this.leadsService.validateLeadNumber(leadNumber);
  }

  @Get('number/:leadNumber')
  @ApiOperation({ summary: 'Get lead by lead number' })
  @ApiParam({ name: 'leadNumber', type: String })
  @ApiResponse({ status: 200, description: 'Returns the lead with customer info' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async getLeadByNumber(@Param('leadNumber') leadNumber: string) {
    return this.leadsService.getLeadByNumber(leadNumber);
  }

  @Get(':leadId/details')
  @ApiOperation({ summary: 'Get lead details with project information' })
  @ApiParam({ name: 'leadId', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the lead with all related data' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async getLeadDetails(@Param('leadId', ParseIntPipe) leadId: number) {
    return this.leadsService.getLeadDetails(leadId);
  }

  @Get(':leadId')
  @ApiOperation({ summary: 'Get lead by ID' })
  @ApiParam({ name: 'leadId', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the lead' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async getLeadById(@Param('leadId', ParseIntPipe) leadId: number) {
    return this.leadsService.getLeadById(leadId);
  }

  @Put(':leadId')
  @ApiOperation({ summary: 'Update lead' })
  @ApiParam({ name: 'leadId', type: Number })
  @ApiResponse({ status: 200, description: 'Lead updated successfully' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async updateLead(
    @Param('leadId', ParseIntPipe) leadId: number,
    @Body() request: UpdateLeadRequestDto,
  ) {
    return this.leadsService.updateLead(leadId, request.lead);
  }

  @Get(':leadId/rejection-info')
  @ApiOperation({ summary: 'Get lead rejection info (can delete contact/company?)' })
  @ApiParam({ name: 'leadId', type: Number })
  @ApiResponse({ status: 200, description: 'Returns rejection info' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async getLeadRejectionInfo(@Param('leadId', ParseIntPipe) leadId: number) {
    return this.leadsService.getLeadRejectionInfo(leadId);
  }

  @Delete(':leadId')
  @ApiOperation({ summary: 'Delete lead' })
  @ApiParam({ name: 'leadId', type: Number })
  @ApiQuery({ name: 'deleteContact', required: false, type: Boolean })
  @ApiQuery({ name: 'deleteCompany', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Lead deleted successfully' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async deleteLead(
    @Param('leadId', ParseIntPipe) leadId: number,
    @Query('deleteContact') deleteContact?: string,
    @Query('deleteCompany') deleteCompany?: string,
  ) {
    const options = {
      deleteContact: deleteContact === 'true',
      deleteCompany: deleteCompany === 'true',
    };
    const result = await this.leadsService.deleteLead(leadId, options);
    return result;
  }
}
