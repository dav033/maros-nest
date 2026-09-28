import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../../../mail/services/mail.service';
import { renderUserInvitationEmail } from './user-invitation-email-templates';

const DEFAULT_APP_URL = 'https://app.marosconstruction.com';

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
    expiresAt: Date;
  }): Promise<void> {
    const rendered = renderUserInvitationEmail({
      recipientEmail: opts.email,
      recipientName: opts.name,
      inviterName: opts.inviterName,
      loginUrl: this.loginUrl(),
      expiresAt: opts.expiresAt,
    });

    await this.mail.sendMail({
      to: [opts.email],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }

  /**
   * The plain login page: the link carries nothing, because it grants nothing. What the
   * recipient needs is the address of the door, and Google does the rest.
   */
  private loginUrl(): string {
    const base =
      this.config.get<string>('TASK_APP_URL')?.trim() || DEFAULT_APP_URL;
    return `${base.replace(/\/+$/, '')}/login`;
  }
}
