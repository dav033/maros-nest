import {
  EMAIL_COLOR,
  escapeHtml,
  renderEmailLayout,
} from '../../../mail/templates/email-layout';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function formatExpiry(expiresAt: Date): string {
  return expiresAt.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * The one email an invited client ever gets. It must say, in this order: who invited
 * them, that they sign in with the Google account this was sent to, and when the
 * invitation stops working.
 */
export function renderUserInvitationEmail(opts: {
  recipientEmail: string;
  recipientName: string | null;
  inviterName: string | null;
  loginUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : 'Hi,';
  const inviter = opts.inviterName ?? 'Maros Construction';
  const expiry = formatExpiry(opts.expiresAt);

  const subject = 'Your Maros Construction access';
  const text = [
    greeting,
    '',
    `${inviter} has given you access to the Maros Construction portal.`,
    '',
    `Sign in with the Google account for ${opts.recipientEmail} — there is no password to set.`,
    '',
    opts.loginUrl,
    '',
    `This invitation expires on ${expiry}.`,
  ].join('\n');

  const html = renderEmailLayout({
    preheader: `${inviter} has given you access to the Maros Construction portal.`,
    heading: 'You have been given access',
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${EMAIL_COLOR.text};">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${EMAIL_COLOR.text};">${escapeHtml(inviter)} has given you access to the Maros Construction portal.</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:${EMAIL_COLOR.text};">Sign in with the Google account for <strong>${escapeHtml(opts.recipientEmail)}</strong> — there is no password to set.</p>
      <p style="margin:14px 0 0;font-size:12px;color:${EMAIL_COLOR.muted};">This invitation expires on ${escapeHtml(expiry)}.</p>`,
    ctaLabel: 'Sign in with Google',
    ctaUrl: opts.loginUrl,
  });

  return { subject, text, html };
}
