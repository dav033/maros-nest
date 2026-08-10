/**
 * HTML for the two emails this feature sends (assignment, daily digest). Table-based
 * layout with everything inlined — the safe baseline for Outlook's Word rendering
 * engine, which ignores most CSS outside of inline `style` attributes. Kept local to
 * `task-notifications/` rather than promoted into `modules/mail/`: nothing else in the
 * app sends HTML mail yet, so there's no second consumer to design a shared system for.
 */

const COLOR = {
  accent: '#0f766e',
  text: '#1e293b',
  muted: '#64748b',
  border: '#e2e8f0',
  background: '#f1f5f9',
  overdue: '#dc2626',
  dueToday: '#d97706',
} as const;

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Task titles are free text — never interpolate one into HTML unescaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:${COLOR.background};font-family:${FONT_STACK};">
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
                      <a href="${opts.ctaUrl}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(opts.ctaLabel)}</a>
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

export function renderTaskAssignedEmail(opts: {
  taskTitle: string;
  taskId: number;
  taskUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `Task assigned: ${opts.taskTitle}`;
  const text = `You were assigned "${opts.taskTitle}" (T-${opts.taskId}).\n\n${opts.taskUrl}`;
  const html = layout({
    preheader: `You were assigned "${opts.taskTitle}"`,
    heading: 'You have a new task',
    bodyHtml: `
      <p style="margin:0 0 6px;font-size:13px;color:${COLOR.muted};">T-${opts.taskId}</p>
      <p style="margin:0;font-size:16px;line-height:1.4;color:${COLOR.text};font-weight:500;">${escapeHtml(opts.taskTitle)}</p>
    `,
    ctaLabel: 'View task',
    ctaUrl: opts.taskUrl,
  });
  return { subject, text, html };
}

function taskListHtml(tasks: Array<{ id: number; title: string }>, color: string): string {
  return `<ul style="margin:0;padding:0;list-style:none;">${tasks
    .map(
      (t) => `
      <li style="padding:8px 0;border-top:1px solid ${COLOR.border};font-size:14px;color:${COLOR.text};">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background-color:${color};margin-right:8px;"></span>
        ${escapeHtml(t.title)}
        <span style="color:${COLOR.muted};font-size:12px;"> — T-${t.id}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

export function renderTaskDigestEmail(opts: {
  overdue: Array<{ id: number; title: string }>;
  dueToday: Array<{ id: number; title: string }>;
  tasksUrl: string;
}): { subject: string; text: string; html: string } {
  const total = opts.overdue.length + opts.dueToday.length;
  const subject = `${total} task${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} attention`;

  const textLines: string[] = [];
  if (opts.overdue.length > 0) {
    textLines.push(`Overdue (${opts.overdue.length}):`);
    textLines.push(...opts.overdue.map((t) => `  - ${t.title} (T-${t.id})`));
    textLines.push('');
  }
  if (opts.dueToday.length > 0) {
    textLines.push(`Due today (${opts.dueToday.length}):`);
    textLines.push(...opts.dueToday.map((t) => `  - ${t.title} (T-${t.id})`));
    textLines.push('');
  }
  textLines.push(opts.tasksUrl);
  const text = textLines.join('\n');

  const sections: string[] = [];
  if (opts.overdue.length > 0) {
    sections.push(`
      <p style="margin:20px 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:${COLOR.overdue};">Overdue · ${opts.overdue.length}</p>
      ${taskListHtml(opts.overdue, COLOR.overdue)}
    `);
  }
  if (opts.dueToday.length > 0) {
    sections.push(`
      <p style="margin:20px 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:${COLOR.dueToday};">Due today · ${opts.dueToday.length}</p>
      ${taskListHtml(opts.dueToday, COLOR.dueToday)}
    `);
  }

  const html = layout({
    preheader: `${total} task${total === 1 ? '' : 's'} need your attention today`,
    heading: "Here's what needs attention",
    bodyHtml: sections.join(''),
    ctaLabel: 'Open my tasks',
    ctaUrl: opts.tasksUrl,
  });
  return { subject, text, html };
}
