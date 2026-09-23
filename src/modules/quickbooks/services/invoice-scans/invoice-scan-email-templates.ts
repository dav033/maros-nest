import {
  EMAIL_COLOR,
  escapeHtml,
  renderEmailLayout,
} from '../../../mail/templates/email-layout';

export interface InvoiceEmailItem {
  id: string;
  /** Invoice number or, failing that, the file name. */
  label: string;
  counterpartyName: string | null;
  projectNumber: string | null;
  total: number | null;
  currency: string | null;
  url: string;
  /** Whole days since the scan was created. */
  daysPending: number;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function money(total: number | null, currency: string | null): string {
  if (total === null) return 'total not read';
  return `${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? 'USD'}`;
}

function itemLine(item: InvoiceEmailItem): string {
  const parts = [item.label];
  if (item.counterpartyName) parts.push(item.counterpartyName);
  parts.push(money(item.total, item.currency));
  parts.push(item.projectNumber ? `project ${item.projectNumber}` : 'no project linked');
  return parts.join(' · ');
}

function itemHtml(item: InvoiceEmailItem, extra?: string): string {
  return `
    <li style="padding:10px 0;border-top:1px solid ${EMAIL_COLOR.border};font-size:14px;color:${EMAIL_COLOR.text};">
      <a href="${escapeHtml(item.url)}" style="color:${EMAIL_COLOR.accent};font-weight:600;text-decoration:none;">${escapeHtml(item.label)}</a>
      ${item.counterpartyName ? `<span> · ${escapeHtml(item.counterpartyName)}</span>` : ''}
      <br />
      <span style="color:${EMAIL_COLOR.muted};font-size:12px;">${escapeHtml(money(item.total, item.currency))} · ${item.projectNumber ? `project ${escapeHtml(item.projectNumber)}` : 'no project linked'}${extra ?? ''}</span>
    </li>`;
}

export function renderInvoiceScanReadyEmail(opts: {
  item: InvoiceEmailItem;
  warnings: string[];
}): RenderedEmail {
  const { item } = opts;
  const subject = `Invoice ready to enter: ${item.label}`;
  const textLines = [
    `A new invoice was scanned and is ready to be entered in QuickBooks.`,
    '',
    itemLine(item),
  ];
  if (opts.warnings.length > 0) {
    textLines.push('', 'Check before entering it:');
    textLines.push(...opts.warnings.map((warning) => `  - ${warning}`));
  }
  textLines.push('', item.url);

  const warningsHtml =
    opts.warnings.length > 0
      ? `
      <p style="margin:18px 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:${EMAIL_COLOR.warning};">Check before entering it</p>
      <ul style="margin:0;padding-left:18px;color:${EMAIL_COLOR.text};font-size:14px;line-height:1.55;">
        ${opts.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}
      </ul>`
      : '';

  const html = renderEmailLayout({
    preheader: `Invoice ${item.label} is ready to enter in QuickBooks`,
    heading: 'An invoice is ready to enter',
    bodyHtml: `
      <ul style="margin:0;padding:0;list-style:none;">${itemHtml(item)}</ul>
      ${warningsHtml}
      <p style="margin:18px 0 0;font-size:13px;color:${EMAIL_COLOR.muted};">Open the invoice to review the extracted details, fix anything that is wrong and tick "Entered in QuickBooks" once it is done.</p>
    `,
    ctaLabel: 'Open invoice',
    ctaUrl: item.url,
  });
  return { subject, text: textLines.join('\n'), html };
}

export function renderInvoicePendingReminderEmail(opts: {
  items: InvoiceEmailItem[];
  listUrl: string;
}): RenderedEmail {
  const count = opts.items.length;
  const subject = `${count} invoice${count === 1 ? '' : 's'} still to enter in QuickBooks`;
  const textLines = [
    `${count} scanned invoice${count === 1 ? ' is' : 's are'} waiting to be entered in QuickBooks:`,
    '',
    ...opts.items.map(
      (item) => `  - ${itemLine(item)} · pending ${item.daysPending} day${item.daysPending === 1 ? '' : 's'}\n    ${item.url}`,
    ),
    '',
    `All pending invoices: ${opts.listUrl}`,
  ];
  const html = renderEmailLayout({
    preheader: `${count} invoice${count === 1 ? '' : 's'} waiting to be entered in QuickBooks`,
    heading: 'Invoices waiting to be entered',
    bodyHtml: `
      <p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:${EMAIL_COLOR.text};">These scanned invoices have not been marked as entered in QuickBooks yet. You will get this reminder every three days until they are.</p>
      <ul style="margin:12px 0 0;padding:0;list-style:none;">
        ${opts.items
          .map((item) =>
            itemHtml(
              item,
              ` · <span style="color:${item.daysPending >= 7 ? EMAIL_COLOR.danger : EMAIL_COLOR.warning};">pending ${item.daysPending} day${item.daysPending === 1 ? '' : 's'}</span>`,
            ),
          )
          .join('')}
      </ul>
    `,
    ctaLabel: 'Open pending invoices',
    ctaUrl: opts.listUrl,
  });
  return { subject, text: textLines.join('\n'), html };
}
