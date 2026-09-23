/**
 * HTML for the two emails this feature sends (assignment, daily digest). Table-based
 * layout with everything inlined — the safe baseline for Outlook's Word rendering
 * engine, which ignores most CSS outside of inline `style` attributes. The chrome
 * (header, CTA, footer) lives in `modules/mail/templates/email-layout.ts`, shared
 * with the invoice-scan emails.
 */

import {
  EMAIL_COLOR,
  escapeHtml,
  renderEmailLayout,
} from '../../mail/templates/email-layout';

const COLOR = {
  ...EMAIL_COLOR,
  overdue: '#dc2626',
  dueToday: '#d97706',
  blocked: '#7c3aed',
} as const;

export type TaskEmailDetails = {
  description?: string | null;
  attachments?: Array<{ fileName: string }>;
};

type TaskEmailSource = {
  descriptionText?: string | null;
  attachments?: string[] | null;
  managedFiles?: Array<{ fileName: string; status: string }> | null;
};

export function taskEmailDetails(task: TaskEmailSource): TaskEmailDetails {
  const managedAttachments = (task.managedFiles ?? [])
    .filter((file) => file.status === 'ready' && file.fileName.trim())
    .map((file) => ({ fileName: file.fileName.trim() }));
  const legacyAttachments = (task.attachments ?? [])
    .map((key) => key.replace(/\\/g, '/').split('/').pop()?.trim() ?? '')
    .filter(Boolean)
    .map((fileName) => ({ fileName }));

  const attachments = [...managedAttachments, ...legacyAttachments].filter(
    (file, index, all) => all.findIndex((candidate) => candidate.fileName === file.fileName) === index,
  );

  return {
    description: task.descriptionText?.trim() || null,
    attachments,
  };
}

function taskDetailsText(details: TaskEmailDetails | undefined, taskUrl: string): string {
  if (!details) return '';
  const description = details.description?.trim();
  const attachments = details.attachments ?? [];
  const sections: string[] = [];
  if (description) sections.push(`Description:\n${description}`);
  if (attachments.length > 0) {
    sections.push(`Attachments:\n${attachments.map((file) => `- ${file.fileName}`).join('\n')}\nOpen the task to view or download them: ${taskUrl}`);
  }
  return sections.join('\n\n');
}

function taskDetailsHtml(details: TaskEmailDetails | undefined, taskUrl: string): string {
  if (!details) return '';
  const description = details.description?.trim();
  const attachments = details.attachments ?? [];
  const sections: string[] = [];
  if (description) {
    sections.push(`
      <p style="margin:18px 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:${COLOR.muted};">Description</p>
      <p style="margin:0;font-size:14px;line-height:1.55;color:${COLOR.text};white-space:pre-wrap;">${escapeHtml(description)}</p>
    `);
  }
  if (attachments.length > 0) {
    sections.push(`
      <p style="margin:18px 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:${COLOR.muted};">Attachments Â· ${attachments.length}</p>
      <ul style="margin:0;padding-left:18px;color:${COLOR.text};font-size:14px;line-height:1.55;">
        ${attachments.map((file) => `<li><a href="${escapeHtml(taskUrl)}" style="color:${COLOR.accent};">${escapeHtml(file.fileName)}</a></li>`).join('')}
      </ul>
      <p style="margin:6px 0 0;font-size:12px;color:${COLOR.muted};">Open the task to view or download the files.</p>
    `);
  }
  return sections.join('');
}

const layout = renderEmailLayout;

export function renderTaskAssignedEmail(opts: {
  taskTitle: string;
  taskId: number;
  taskUrl: string;
  taskDetails?: TaskEmailDetails;
}): { subject: string; text: string; html: string } {
  const subject = `Task assigned: ${opts.taskTitle}`;
  const detailsText = taskDetailsText(opts.taskDetails, opts.taskUrl);
  const text = [`You were assigned "${opts.taskTitle}" (T-${opts.taskId}).`, detailsText, opts.taskUrl]
    .filter(Boolean)
    .join('\n\n');
  const html = layout({
    preheader: `You were assigned "${opts.taskTitle}"`,
    heading: 'You have a new task',
    bodyHtml: `
      <p style="margin:0 0 6px;font-size:13px;color:${COLOR.muted};">T-${opts.taskId}</p>
      <p style="margin:0;font-size:16px;line-height:1.4;color:${COLOR.text};font-weight:500;">${escapeHtml(opts.taskTitle)}</p>
      ${taskDetailsHtml(opts.taskDetails, opts.taskUrl)}
    `,
    ctaLabel: 'View task',
    ctaUrl: opts.taskUrl,
  });
  return { subject, text, html };
}

export function renderTaskSignalEmail(opts: {
  kind: 'status' | 'blocked' | 'comment' | 'mention';
  taskTitle: string;
  taskId: number;
  taskUrl: string;
  details?: string;
  taskDetails?: TaskEmailDetails;
}): { subject: string; text: string; html: string } {
  const labels = {
    status: { subject: 'Task status changed', heading: 'A task status changed' },
    blocked: { subject: 'Task blocked', heading: 'A task was blocked' },
    comment: { subject: 'New task comment', heading: 'A task received a comment' },
    mention: { subject: 'You were mentioned on a task', heading: 'You were mentioned' },
  } as const;
  const label = labels[opts.kind];
  const details = opts.details ? `\n\n${opts.details}` : '';
  const taskDetailsTextValue = taskDetailsText(opts.taskDetails, opts.taskUrl);
  return {
    subject: `${label.subject}: ${opts.taskTitle}`,
    text: [`${opts.taskTitle} (T-${opts.taskId})${details}`, taskDetailsTextValue, opts.taskUrl]
      .filter(Boolean)
      .join('\n\n'),
    html: layout({
      preheader: `${label.subject}: ${opts.taskTitle}`,
      heading: label.heading,
      bodyHtml: `
        <p style="margin:0 0 6px;font-size:13px;color:${COLOR.muted};">T-${opts.taskId}</p>
        <p style="margin:0;font-size:16px;line-height:1.4;color:${COLOR.text};font-weight:500;">${escapeHtml(opts.taskTitle)}</p>
        ${opts.details ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:${COLOR.muted};">${escapeHtml(opts.details)}</p>` : ''}
        ${taskDetailsHtml(opts.taskDetails, opts.taskUrl)}
      `,
      ctaLabel: 'View task',
      ctaUrl: opts.taskUrl,
    }),
  };
}

export function renderTaskPermitReminderEmail(opts: {
  taskTitle: string;
  taskId: number;
  taskUrl: string;
  taskDetails?: TaskEmailDetails;
}): { subject: string; text: string; html: string } {
  const subject = `Permit task due soon: ${opts.taskTitle}`;
  const detailsText = taskDetailsText(opts.taskDetails, opts.taskUrl);
  const text = [`Permit task "${opts.taskTitle}" (T-${opts.taskId}) is due in three days.`, detailsText, opts.taskUrl]
    .filter(Boolean)
    .join('\n\n');
  const html = layout({
    preheader: `Permit task "${opts.taskTitle}" is due in three days`,
    heading: 'Permit deadline coming up',
    bodyHtml: `<p style="margin:0;font-size:16px;line-height:1.4;color:${COLOR.text};font-weight:500;">${escapeHtml(opts.taskTitle)}</p>${taskDetailsHtml(opts.taskDetails, opts.taskUrl)}`,
    ctaLabel: 'Open task',
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
  blocked?: Array<{ id: number; title: string }>;
  tasksUrl: string;
}): { subject: string; text: string; html: string } {
  const blocked = opts.blocked ?? [];
  const total = opts.overdue.length + opts.dueToday.length + blocked.length;
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
  if (blocked.length > 0) {
    textLines.push(`Blocked for 3+ days (${blocked.length}):`);
    textLines.push(...blocked.map((t) => `  - ${t.title} (T-${t.id})`));
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
  if (blocked.length > 0) {
    sections.push(`
      <p style="margin:20px 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:${COLOR.blocked};">Blocked for 3+ days · ${blocked.length}</p>
      ${taskListHtml(blocked, COLOR.blocked)}
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
