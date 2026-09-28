import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../../../mail/services/mail.service';
import { renderUserInvitationEmail } from './user-invitation-email-templates';

const DEFAULT_FRONTEND_URL = 'https://marosconstruction.com';

/**
 * The invitation email.
 *
 * Unlike every other MailService call-site in this codebase, this one does NOT swallow
 * a send failure. Those notifications are commentary on work that already happened; an
 * invitation IS the access grant. An admin who is told "invited" while the message
 * bounced would wait for a client who never heard anything, so the error propagates and
 * rolls the whole invitation back.
 */
@Injectable()
export class UserInvitationNotificationsService {
  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async sendInvitation(opts: {
    email: string;
    name: string | null;
    inviterName: string | null;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const rendered = renderUserInvitationEmail({
      recipientEmail: opts.email,
      recipientName: opts.name,
      inviterName: opts.inviterName,
      acceptUrl: this.acceptUrl(opts.token),
      expiresAt: opts.expiresAt,
    });

    await this.mail.sendMail({
      to: [opts.email],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }

  private acceptUrl(token: string): string {
    const base =
      this.config.get<string>('FRONTEND_URL')?.trim() || DEFAULT_FRONTEND_URL;
    return `${base.replace(/\/+$/, '')}/login?invitation=${encodeURIComponent(token)}`;
  }
}
