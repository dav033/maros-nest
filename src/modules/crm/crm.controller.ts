import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ContactsService } from '../contacts/services/contacts.service';
import { CompaniesService } from '../companies/services/companies.service';
import { LeadIntakeService } from './services/lead-intake.service';
import { ContactsCompaniesResponseDto } from './dto/contacts-companies-response.dto';
import { LeadIntakeRequestDto, LeadIntakeResponseDto } from './dto/lead-intake-request.dto';

@ApiTags('crm')
@Controller('crm')
export class CrmController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly companiesService: CompaniesService,
    private readonly leadIntakeService: LeadIntakeService,
  ) {}

  @Get('customers')
  @ApiOperation({ summary: 'Get all customers (contacts and companies)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns all customers',
    type: ContactsCompaniesResponseDto
  })
  async getCustomers(): Promise<ContactsCompaniesResponseDto> {
    const contacts = await this.contactsService.findCustomers();
    const companies = await this.companiesService.findCustomers();
    
    return {
      contacts,
      companies,
    };
  }

  @Get('clients')
  @ApiOperation({ summary: 'Get all clients (contacts and companies)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns all clients',
    type: ContactsCompaniesResponseDto
  })
  async getClients(): Promise<ContactsCompaniesResponseDto> {
    const contacts = await this.contactsService.findClients();
    const companies = await this.companiesService.findClients();
    
    return {
      contacts,
      companies,
    };
  }

  @Post('lead-intake')
  @ApiOperation({ 
    summary: 'Process lead intake from n8n',
    description: `
      Unified endpoint for n8n lead intake automation.
      Handles all 4 cases:
      1. No company, no contact: Creates both and associates them
      2. No company, has contact: Creates company and associates with existing contact
      3. Has company, no contact: Creates contact associated with company
      4. Has both: Uses existing entities
      
      Always creates a lead with inReview=true.
    `
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Lead intake processed successfully',
    type: LeadIntakeResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  async processLeadIntake(@Body() dto: LeadIntakeRequestDto): Promise<LeadIntakeResponseDto> {
    return this.leadIntakeService.processLeadIntake(dto);
  }
}
