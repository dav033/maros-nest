import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { ExternalServiceException } from '../../../common/exceptions';
import mailConfig from '../../../config/mail.config';

export interface SendMailInput {
  to: string[];
  cc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export interface SendMailResult {
  sent: boolean;
  messageId?: string;
}

interface MailTransport {
  send(input: SendMailInput & { from: string }): Promise<{ messageId?: string }>;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transport?: MailTransport;

  constructor(
    @Inject(mailConfig.KEY)
    private readonly config: ConfigType<typeof mailConfig>,
  ) {}

  async sendMail(input: SendMailInput): Promise<SendMailResult> {
    this.logger.log(`sendMail called — to: ${JSON.stringify(input.to)}, cc: ${JSON.stringify(input.cc)}, subject: "${input.subject}"`);

    this.ensureConfigured();

    const transport = this.getTransport();

    const payload = {
      from: this.config.from,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    };
    this.logger.log(`Sending email — from: "${payload.from}", to: ${JSON.stringify(payload.to)}, subject: "${payload.subject}"`);

    let result: { messageId?: string };
    try {
      result = await transport.send(payload);
      this.logger.log(`Email sent successfully — messageId: ${result?.messageId ?? 'N/A'}`);
    } catch (error) {
      const originalError = error instanceof Error ? error : undefined;
      const message = originalError?.message ?? String(error);
      this.logger.error(`Email send FAILED — error: ${message}`, originalError?.stack ?? '');
      throw new ExternalServiceException(
        `Mail send failed: ${message}`,
        'Mail',
        originalError,
      );
    }

    return {
      sent: true,
      messageId: result?.messageId,
    };
  }

  private ensureConfigured(): void {
    const missing: string[] = [];
    if (!this.config.from) missing.push('MAIL_FROM');
    if (!this.config.transport) missing.push('MAIL_TRANSPORT');

    if (this.config.transport === 'smtp') {
      if (!this.config.smtpHost) missing.push('MAIL_SMTP_HOST');
      if (this.config.smtpUser && !this.config.smtpPassword) {
        missing.push('MAIL_SMTP_PASSWORD');
      }
      if (!this.config.smtpUser && this.config.smtpPassword) {
        missing.push('MAIL_SMTP_USER');
      }
    }

    if (missing.length > 0) {
      throw new ExternalServiceException(
        `Mail is not configured. Missing: ${missing.join(', ')}`,
        'Mail',
      );
    }
  }

  private getTransport(): MailTransport {
    if (this.transport) return this.transport;
    this.transport = this.createTransport();
    return this.transport;
  }

  private createTransport(): MailTransport {
    const { transport } = this.config;
    this.logger.log(`Initializing mail transport: ${transport || 'unset'}`);
    this.logger.log(`Mail config — from: "${this.config.from}", transport: "${this.config.transport}", host: "${this.config.smtpHost}", port: ${this.config.smtpPort}, secure: ${this.config.smtpSecure}, user: "${this.config.smtpUser}", apiKey: ${this.config.apiKey ? '***set***' : 'unset'}`);

    if (transport === 'smtp') {
      const smtpOptions = {
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure,
        auth: this.config.smtpUser
          ? {
              user: this.config.smtpUser,
              pass: this.config.smtpPassword,
            }
          : undefined,
      };
      this.logger.log(`Creating SMTP transport — host: ${smtpOptions.host}, port: ${smtpOptions.port}, secure: ${smtpOptions.secure}, auth user: ${smtpOptions.auth?.user ?? 'none'}`);

      const smtpTransporter: Transporter = nodemailer.createTransport(smtpOptions);

      smtpTransporter.on('error', (err) => {
        this.logger.error(`SMTP transport error event: ${err.message}`, err.stack);
      });

      return {
        send: async (payload) => {
          this.logger.log(`SMTP sendMail — from: "${payload.from}", to: ${JSON.stringify(payload.to)}, cc: ${JSON.stringify(payload.cc)}, subject: "${payload.subject}"`);
          const info = await smtpTransporter.sendMail({
            from: payload.from,
            to: payload.to,
            cc: payload.cc,
            subject: payload.subject,
            text: payload.text,
            html: payload.html,
            attachments: payload.attachments,
          });
          this.logger.log(`SMTP sendMail response — messageId: ${info.messageId}, response: ${JSON.stringify(info.response ?? 'N/A')}`);
          return { messageId: info.messageId };
        },
      };
    }

    throw new ExternalServiceException(
      `Mail transport "${transport}" is not supported. Supported transports: smtp.`,
      'Mail',
    );
  }
}
