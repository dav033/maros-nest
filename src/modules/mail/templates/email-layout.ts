/**
 * Shared chrome for every HTML email the API sends. Table-based layout with
 * everything inlined — the safe baseline for Outlook's Word rendering engine,
 * which ignores most CSS outside of inline `style` attributes.
 */

export const EMAIL_COLOR = {
  accent: '#0f766e',
  text: '#1e293b',
  muted: '#64748b',
  border: '#e2e8f0',
  background: '#f1f5f9',
  warning: '#d97706',
  danger: '#dc2626',
} as const;

export const EMAIL_FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** User-provided text (task titles, vendor names…) is never interpolated unescaped. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderEmailLayout(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  const COLOR = EMAIL_COLOR;
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:${COLOR.background};font-family:${EMAIL_FONT_STACK};">
    <span style="display:none;font-size:1px;color:${COLOR.background};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(opts.preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLOR.background};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;border:1px solid ${COLOR.border};">
            <tr>
              <td style="background-color:${COLOR.accent};padding:18px 28px;border-radius:12px 12px 0 0;">
                <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:0.02em;">Maros Construction</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 16px;font-size:19px;line-height:1.3;font-weight:600;color:${COLOR.text};">${escapeHtml(opts.heading)}</h1>
                ${opts.bodyHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td style="border-radius:8px;background-color:${COLOR.accent};">
                <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(opts.ctaLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid ${COLOR.border};">
                <p style="margin:0;font-size:12px;color:${COLOR.muted};">This is an automated message from the Maros Construction CRM.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
