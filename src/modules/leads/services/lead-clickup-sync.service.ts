import { Injectable, Logger } from '@nestjs/common';
import { ClickUpService } from '../../clickup/services/clickup.service';
import { ClickUpTaskRequestDto } from '../../clickup/dto/clickup-task-request.dto';
import { ContactsService } from '../../contacts/services/contacts.service';
import { ClickUpRoutingService } from '../../clickup/services/clickup-routing.service';
import { Lead } from '../../../entities/lead.entity';
import { LeadType } from '../../../common/enums/lead-type.enum';

@Injectable()
export class LeadClickUpSyncService {
  private readonly logger = new Logger(LeadClickUpSyncService.name);

  constructor(
    private readonly clickUpService: ClickUpService,
    private readonly contactsService: ContactsService,
    private readonly routingService: ClickUpRoutingService,
  ) {}

  async syncLeadCreate(lead: Lead): Promise<void> {
    this.logger.log(`Starting ClickUp sync for lead creation: ${lead.id} - ${lead.leadNumber} (${lead.leadType})`);
    try {
      const taskRequest = await this.buildClickUpTaskRequest(lead);
      this.logger.debug(`Task request built: ${JSON.stringify(taskRequest, null, 2)}`);
      
      const response = await this.clickUpService.createTask(lead.leadType || LeadType.CONSTRUCTION, taskRequest);
      
      this.logger.log(`ClickUp CREATE ok: taskId=${response.id} lead=${lead.leadNumber} type=${lead.leadType}`);
    } catch (error: any) {
      this.logger.error(`Error syncing lead creation ${lead.id} with ClickUp: ${error.message}`, error.stack);
      // Don't throw - we don't want to fail lead creation if ClickUp sync fails
    }
  }

  async syncLeadUpdate(lead: Lead): Promise<void> {
    try {
      const taskId = await this.clickUpService.findTaskIdByLeadNumber(lead.leadType || LeadType.CONSTRUCTION, lead.leadNumber || '');
      
      if (!taskId) {
        this.logger.warn(`ClickUp UPDATE skipped: task not found for lead=${lead.leadNumber} (type=${lead.leadType})`);
        return;
      }

      const taskRequest = await this.buildClickUpTaskRequest(lead);
      await this.clickUpService.updateTask(taskId, taskRequest);
      
      this.logger.log(`ClickUp UPDATE ok: taskId=${taskId} lead=${lead.leadNumber} type=${lead.leadType}`);
    } catch (error: any) {
      this.logger.error(`Error syncing lead update ${lead.id} with ClickUp: ${error.message}`, error.stack);
    }
  }

  async syncLeadDelete(lead: Lead): Promise<void> {
    try {
      const deleted = await this.clickUpService.deleteTaskByLeadNumber(lead.leadType || LeadType.CONSTRUCTION, lead.leadNumber || '');
      
      if (deleted) {
        this.logger.log(`ClickUp DELETE ok: lead=${lead.leadNumber} type=${lead.leadType}`);
      } else {
        this.logger.warn(`ClickUp DELETE skipped: task not found for lead=${lead.leadNumber}`);
      }
    } catch (error: any) {
      this.logger.error(`Error syncing lead deletion ${lead.id} with ClickUp: ${error.message}`, error.stack);
    }
  }

  private async buildClickUpTaskRequest(lead: Lead): Promise<ClickUpTaskRequestDto> {
    const route = this.routingService.route(lead.leadType || LeadType.CONSTRUCTION);
    const customFields: Array<{ id: string; value: any }> = [];

    // Lead Number field
    if (lead.leadNumber && route.fields.leadNumberId) {
      customFields.push({
        id: route.fields.leadNumberId,
        value: lead.leadNumber,
      });
    }

    // Location field
    if (lead.location && route.fields.locationTextId) {
      customFields.push({
        id: route.fields.locationTextId,
        value: lead.location,
      });
    }

    // Contact fields
    if (lead.contact) {
      const contact = await this.contactsService.getContactById(lead.contact.id);
      
      if (contact && route.fields.contactNameId) {
        customFields.push({
          id: route.fields.contactNameId,
          value: contact.name || '',
        });
      }

      if (contact && route.fields.customerNameId) {
        customFields.push({
          id: route.fields.customerNameId,
          value: contact.name || '',
        });
      }

      if (contact && contact.email && route.fields.emailId) {
        customFields.push({
          id: route.fields.emailId,
          value: contact.email,
        });
      }

      if (contact && contact.phone) {
        // Try phoneId first (for phone type fields in ClickUp)
        if (route.fields.phoneId) {
          customFields.push({
            id: route.fields.phoneId,
            value: this.formatPhoneForClickUp(contact.phone),
          });
        }
        // Also try phoneTextId (for text type fields)
        if (route.fields.phoneTextId) {
          customFields.push({
            id: route.fields.phoneTextId,
            value: contact.phone,
          });
        }
      }
    }

    // Build description
    const description = this.buildDescription(lead);

    // Build task name
    const taskName = `Lead: ${lead.name} (${lead.leadNumber})`;

    // Convert start date to timestamp (milliseconds)
    let startDate: number | undefined;
    if (lead.startDate) {
      const date = lead.startDate instanceof Date ? lead.startDate : new Date(lead.startDate);
      startDate = date.getTime();
    }

    return {
      name: taskName,
      description,
      custom_fields: customFields,
      tags: ['lead', lead.leadType?.toLowerCase() || 'construction', 'automated'],
      start_date: startDate,
    };
  }

  private buildDescription(lead: Lead): string {
    const parts = [
      '**New Lead Created**',
      '',
      '**Details:**',
      `- **Lead Number:** ${lead.leadNumber || 'N/A'}`,
      `- **Name:** ${lead.name || 'N/A'}`,
    ];

    if (lead.location) {
      parts.push(`- **Location:** ${lead.location}`);
    }

    if (lead.startDate) {
      const date = lead.startDate instanceof Date ? lead.startDate : new Date(lead.startDate);
      const formatted = date.toLocaleDateString('en-US');
      parts.push(`- **Start Date:** ${formatted}`);
    }

    if (lead.leadType) {
      parts.push(`- **Type:** ${lead.leadType}`);
    }

    if (lead.contact) {
      parts.push(`- **Contact:** ${lead.contact.name || 'N/A'}`);
      if (lead.contact.email) {
        parts.push(`- **Email:** ${lead.contact.email}`);
      }
      if (lead.contact.phone) {
        parts.push(`- **Phone:** ${lead.contact.phone}`);
      }
    }

    parts.push('', '*Task created automatically from application*');

    return parts.join('\n');
  }

  private formatPhoneForClickUp(phone: string): string {
    // ClickUp expects phone numbers in format: { "country_code": "US", "number": "1234567890" }
    // For simplicity, we'll just return the formatted string
    // You can enhance this to parse and format properly
    const cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.length === 10) {
      return `+1${cleaned}`; // Assume US if 10 digits
    }
    
    return phone;
  }
}
