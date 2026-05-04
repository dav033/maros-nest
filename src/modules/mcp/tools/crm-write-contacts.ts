import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CreateContactDto } from '../../contacts/contact-management/dto/create-contact.dto';
import { UpdateContactDto } from '../../contacts/contact-management/dto/update-contact.dto';
import { McpToolDeps, jsonContent } from './shared';
import { deletedMessage } from './crm-write-shared';

export function registerContactWriteTools(server: McpServer, deps: McpToolDeps) {
  server.tool(
    'delete_contact',
    'Delete a contact by its ID. Associated leads will have their contact reference cleared',
    { contactId: z.number().describe('The contact ID to delete') },
    async ({ contactId }) => {
      await deps.contactsService.delete(contactId);
      return deletedMessage('Contact', contactId);
    },
  );

  server.tool(
    'create_contact',
    'Create a new contact in the CRM',
    {
      name: z.string().optional().describe('Contact name'),
      occupation: z.string().optional().describe('Occupation'),
      phone: z.string().optional().describe('Phone number'),
      email: z.string().optional().describe('Email address'),
      address: z.string().optional().describe('Address'),
      addressLink: z.string().optional().describe('Address link (Google Maps URL)'),
      isCustomer: z.boolean().optional().describe('Is the contact a customer?'),
      isClient: z.boolean().optional().describe('Is the contact a client?'),
      companyId: z.number().optional().describe('Company ID to associate with'),
      notes: z.array(z.string()).optional().describe('Notes'),
    },
    async (fields) => {
      const data = await deps.contactsService.create(fields as CreateContactDto);
      return jsonContent(data);
    },
  );

  server.tool(
    'update_contact',
    'Update an existing contact by its ID. Only provided fields are updated',
    {
      contactId: z.number().describe('The contact ID to update'),
      name: z.string().optional().describe('Contact name'),
      occupation: z.string().optional().describe('Occupation'),
      phone: z.string().optional().describe('Phone number'),
      email: z.string().optional().describe('Email address'),
      address: z.string().optional().describe('Address'),
      addressLink: z.string().optional().describe('Address link'),
      isCustomer: z.boolean().optional().describe('Is the contact a customer?'),
      isClient: z.boolean().optional().describe('Is the contact a client?'),
      companyId: z.number().optional().describe('Company ID'),
      notes: z
        .array(z.string())
        .optional()
        .describe('Notes (replaces all existing notes)'),
    },
    async ({ contactId, ...fields }) => {
      const data = await deps.contactsService.update(
        contactId,
        fields as UpdateContactDto,
      );
      return jsonContent(data);
    },
  );
}
