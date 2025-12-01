import { registerAs } from '@nestjs/config';

export interface ClickUpFieldsConfig {
  leadNumberId: string;
  contactNameId: string;
  customerNameId: string;
  emailId: string;
  phoneId?: string;
  phoneTextId?: string;
  notesId: string;
  locationTextId: string;
  locationId?: string;
}

export interface ClickUpRouteConfig {
  listId: string;
  fields: ClickUpFieldsConfig;
}

export interface ClickUpRoutesMap {
  CONSTRUCTION: ClickUpRouteConfig;
  PLUMBING: ClickUpRouteConfig;
}

export interface ClickUpConfig {
  apiUrl: string;
  accessToken: string;
  clientId: string;
  clientSecret: string;
  teamId: string;
  spaceId: string;
  listId: string;
  defaultPriority: number;
  routes: {
    map: ClickUpRoutesMap;
  };
}

export default registerAs(
  'clickup',
  (): ClickUpConfig => ({
    apiUrl: process.env.CLICKUP_API_URL || 'https://api.clickup.com/api/v2',
    accessToken: process.env.CLICKUP_ACCESS_TOKEN || '',
    clientId: process.env.CLICKUP_CLIENT_ID || '',
    clientSecret: process.env.CLICKUP_CLIENT_SECRET || '',
    teamId: process.env.CLICKUP_TEAM_ID || '',
    spaceId: process.env.CLICKUP_SPACE_ID || '',
    listId: process.env.CLICKUP_LIST_ID || '',
    defaultPriority: parseInt(process.env.CLICKUP_DEFAULT_PRIORITY || '3', 10),
    routes: {
      map: {
        CONSTRUCTION: {
          listId: process.env.CLICKUP_LIST_ID_CONSTRUCTION || '',
          fields: {
            leadNumberId: process.env.CLICKUP_CF_CONSTRUCTION_LEADNUMBER || '',
            contactNameId: process.env.CLICKUP_CF_CONSTRUCTION_CONTACT_NAME || '',
            customerNameId: process.env.CLICKUP_CF_CONSTRUCTION_CUSTOMER_NAME || '',
            emailId: process.env.CLICKUP_CF_CONSTRUCTION_EMAIL || '',
            phoneTextId: process.env.CLICKUP_CF_CONSTRUCTION_PHONE || '',
            notesId: process.env.CLICKUP_CF_CONSTRUCTION_NOTES || '',
            locationTextId: process.env.CLICKUP_CF_CONSTRUCTION_LOCATION_TEXT || '',
            locationId: process.env.CLICKUP_CF_CONSTRUCTION_LOCATION || '',
          },
        },
        PLUMBING: {
          listId: process.env.CLICKUP_LIST_ID_PLUMBING || '',
          fields: {
            leadNumberId: process.env.CLICKUP_CF_PLUMBING_LEADNUMBER || '',
            locationTextId: process.env.CLICKUP_CF_PLUMBING_LOCATION_TEXT || '',
            contactNameId: process.env.CLICKUP_CF_PLUMBING_CONTACT_NAME || '',
            customerNameId: process.env.CLICKUP_CF_PLUMBING_CUSTOMER_NAME || '',
            emailId: process.env.CLICKUP_CF_PLUMBING_EMAIL || '',
            phoneId: process.env.CLICKUP_CF_PLUMBING_PHONE || '',
            notesId: process.env.CLICKUP_CF_PLUMBING_NOTES || '',
          },
        },
      },
    },
  }),
);
