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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ContactsService, ContactValidationResponse } from './services/contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ContactValidationResponseDto } from './dto/contact-validation-response.dto';

@ApiTags('contacts')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get('all')
  @ApiOperation({ summary: 'Get all contacts' })
  @ApiResponse({ status: 200, description: 'Returns all contacts' })
  async getContacts() {
    return this.contactsService.findAll();
  }

  @Get('company/:companyId')
  @ApiOperation({ summary: 'Get contacts by company' })
  @ApiParam({ name: 'companyId', type: Number })
  @ApiResponse({ status: 200, description: 'Returns contacts for the company' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  async getContactsByCompany(
    @Param('companyId', ParseIntPipe) companyId: number,
  ) {
    return this.contactsService.findByCompany(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contact by ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the contact' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async getContactById(@Param('id', ParseIntPipe) id: number) {
    return this.contactsService.getContactById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create contact' })
  @ApiResponse({ status: 200, description: 'Contact created successfully' })
  async createContact(@Body() contact: CreateContactDto) {
    return this.contactsService.create(contact);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update contact' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Contact updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async updateContact(
    @Param('id', ParseIntPipe) id: number,
    @Body() contact: UpdateContactDto,
  ) {
    // Validate that if contact.id is provided, it matches the path parameter
    if ((contact as any).id !== undefined && (contact as any).id !== id) {
      throw new BadRequestException('ID mismatch');
    }
    
    // Remove id from DTO to prevent updates
    const { id: _, ...contactData } = contact as any;
    
    return this.contactsService.update(id, contactData);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete contact' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Contact deleted successfully' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async deleteContact(@Param('id', ParseIntPipe) id: number) {
    await this.contactsService.delete(id);
  }

  @Get('validate')
  @ApiOperation({ summary: 'Validate contact availability' })
  @ApiQuery({ name: 'name', required: false, type: String })
  @ApiQuery({ name: 'email', required: false, type: String })
  @ApiQuery({ name: 'phone', required: false, type: String })
  @ApiQuery({ name: 'excludeId', required: false, type: Number })
  @ApiResponse({ 
    status: 200, 
    description: 'Validation result',
    type: ContactValidationResponseDto
  })
  async validateContact(
    @Query('name') name?: string,
    @Query('email') email?: string,
    @Query('phone') phone?: string,
    @Query('excludeId') excludeId?: number,
  ): Promise<ContactValidationResponse> {
    return this.contactsService.validateAvailability(name, email, phone, excludeId);
  }
}
