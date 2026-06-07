import { registerAs } from '@nestjs/config';

export interface MailConfig {
  from: string;
  transport: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpSecure: boolean;
  apiKey: string;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export default registerAs(
  'mail',
  (): MailConfig => ({
    from: process.env.MAIL_FROM || '',
    transport: (process.env.MAIL_TRANSPORT || '').toLowerCase(),
    smtpHost: process.env.MAIL_SMTP_HOST || '',
    smtpPort: toPositiveInt(process.env.MAIL_SMTP_PORT, 587),
    smtpUser: process.env.MAIL_SMTP_USER || '',
    smtpPassword: process.env.MAIL_SMTP_PASSWORD || '',
    smtpSecure:
      (process.env.MAIL_SMTP_SECURE || '').toLowerCase() === 'true',
    apiKey: process.env.MAIL_API_KEY || '',
  }),
);
