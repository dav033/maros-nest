import { registerAs } from '@nestjs/config';

export interface N8nConfig {
  webhookUrl: string;
}

export default registerAs(
  'n8n',
  (): N8nConfig => ({
    webhookUrl: process.env.N8N_WEBHOOK_URL || 'https://n8n.marosconstruction.com/webhook/',
  }),
);






