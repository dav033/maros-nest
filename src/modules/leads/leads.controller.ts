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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { LeadsService } from './services/leads.service';
import { CreateLeadByNewContactDto } from './dto/create-lead-by-new-contact.dto';
import { CreateLeadByExistingContactDto } from './dto/create-lead-by-existing-contact.dto';
import { GetLeadsByTypeDto } from './dto/get-leads-by-type.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadNumberValidationResponseDto } from './dto/lead-number-validation-response.dto';
import { LeadType } from '../../common/enums/lead-type.enum';

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all leads' })
  @ApiResponse({ status: 200, description: 'Returns all leads' })
  async getAllLeads() {
    return this.leadsService.getAllLeads();
  }

  @Post('type')
  @ApiOperation({ summary: 'Get leads by type (POST with body)' })
  @ApiResponse({ status: 200, description: 'Returns leads filtered by type' })
  async getLeadsByType(@Body() request: GetLeadsByTypeDto) {
    return this.leadsService.getLeadsByType(request.type);
  }

  @Get('type')
  @ApiOperation({ summary: 'Get leads by type (GET with query param)' })
  @ApiQuery({ name: 'type', enum: LeadType })
  @ApiResponse({ status: 200, description: 'Returns leads filtered by type' })
  async getLeadsByTypeGet(@Query('type') type: LeadType) {
    return this.leadsService.getLeadsByType(type);
  }

  @Post('new-contact')
  @ApiOperation({ summary: 'Create lead with new contact' })
  @ApiQuery({ 
    name: 'skipClickUpSync', 
    required: false, 
    type: Boolean,
    description: 'Skip ClickUp synchronization'
  })
  @ApiQuery({ 
    name: 'leadType', 
    required: false, 
    enum: LeadType,
    description: 'Lead type for number generation if leadNumber is not provided'
  })
  @ApiResponse({ status: 200, description: 'Lead created successfully' })
  async createLeadByNewContact(
    @Body() request: CreateLeadByNewContactDto,
    @Query('skipClickUpSync') skipClickUpSync?: string,
    @Query('leadType') leadType?: LeadType,
  ) {
    const skip = skipClickUpSync === 'true';
    return this.leadsService.createLeadWithNewContact(
      request.lead,
      request.contact,
      skip,
      leadType,
    );
  }

  @Post('existing-contact')
  @ApiOperation({ summary: 'Create lead with existing contact' })
  @ApiQuery({ 
    name: 'skipClickUpSync', 
    required: false, 
    type: Boolean,
    description: 'Skip ClickUp synchronization'
  })
  @ApiQuery({ 
    name: 'leadType', 
    required: false, 
    enum: LeadType,
    description: 'Lead type for number generation if leadNumber is not provided'
  })
  @ApiResponse({ status: 200, description: 'Lead created successfully' })
  async createLeadByExistingContact(
    @Body() request: CreateLeadByExistingContactDto,
    @Query('skipClickUpSync') skipClickUpSync?: string,
    @Query('leadType') leadType?: LeadType,
  ) {
    const skip = skipClickUpSync === 'true';
    return this.leadsService.createLeadWithExistingContact(
      request.lead,
      request.contactId,
      skip,
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
    @Body() request: { lead: CreateLeadDto },
  ) {
    return this.leadsService.updateLead(leadId, request.lead);
  }

  @Delete(':leadId')
  @ApiOperation({ summary: 'Delete lead' })
  @ApiParam({ name: 'leadId', type: Number })
  @ApiResponse({ status: 200, description: 'Lead deleted successfully' })
  @ApiResponse({ status: 404, description: 'Lead not found' })
  async deleteLead(@Param('leadId', ParseIntPipe) leadId: number) {
    const deleted = await this.leadsService.deleteLead(leadId);
    if (deleted) {
      return { message: 'Lead eliminado correctamente' };
    }
  }
}
