import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ContactsService } from '../contacts/services/contacts.service';
import { CompaniesService } from '../companies/services/companies.service';
import { ContactsCompaniesResponseDto } from './dto/contacts-companies-response.dto';

@ApiTags('crm')
@Controller('crm')
export class CrmController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly companiesService: CompaniesService,
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
}
