import type { InvoiceScan } from '../../entities/invoice-scan.entity';
import {
  buildAttachableMultipart,
  buildBillPreview,
  mergeNote,
  MAX_PRIVATE_NOTE,
  safeUploadName,
} from './qbo-write.utils';

function scan(overrides: { data?: Record<string, unknown> | null; enteredAt?: Date | null } = {}): InvoiceScan {
  const data =
    overrides.data === null
      ? null
      : {
          direction: 'incoming',
          classification: 'materials_expense',
          counterpartyName: 'Lion Plumbing Supply Inc.',
          counterpartyId: '58',
          counterpartyType: 'Vendor',
          invoiceNumber: 'INV-8841',
          issueDate: '2026-10-16',
          dueDate: '2026-11-15',
          currency: 'USD',
          subtotal: 900,
          taxTotal: 80.89,
          total: 980.89,
          paymentStatus: 'unpaid',
          confidence: 0.9,
          lineItems: [],
          ...overrides.data,
        };
  return { id: 'scan-1', extractedData: data, enteredAt: overrides.enteredAt ?? null } as unknown as InvoiceScan;
}

describe('buildBillPreview', () => {
  it('builds the exact bill payload when everything is known', () => {
    const preview = buildBillPreview(scan(), { accountId: '54' });

    expect(preview.ready).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.payload).toEqual({
      VendorRef: { value: '58' },
      TxnDate: '2026-10-16',
      DueDate: '2026-11-15',
      DocNumber: 'INV-8841',
      PrivateNote: 'Maros invoice scan scan-1',
      Line: [
        {
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: 980.89,
          Description: 'Invoice INV-8841 - Lion Plumbing Supply Inc.',
          AccountBasedExpenseLineDetail: { AccountRef: { value: '54' } },
        },
      ],
    });
  });

  it('never guesses the expense account', () => {
    const preview = buildBillPreview(scan());

    expect(preview.ready).toBe(false);
    expect(preview.payload).toBeNull();
    expect(preview.blockers).toEqual([expect.stringContaining('expense account')]);
  });

  it.each([
    ['no extracted data', { data: null }, 'no extracted data'],
    ['an outgoing invoice', { data: { direction: 'outgoing' } }, 'incoming'],
    ['a vendor not matched to QuickBooks', { data: { counterpartyId: null } }, 'vendor is not matched'],
    ['a customer instead of a vendor', { data: { counterpartyType: 'Customer' } }, 'vendor is not matched'],
    ['no total', { data: { total: null } }, 'positive total'],
    ['a zero total', { data: { total: 0 } }, 'positive total'],
    ['no issue date', { data: { issueDate: null } }, 'issue date'],
    ['a scan already entered', { enteredAt: new Date() }, 'already marked'],
  ])('is blocked by %s', (_label, overrides, text) => {
    const preview = buildBillPreview(scan(overrides as never), { accountId: '54' });

    expect(preview.ready).toBe(false);
    expect(preview.blockers.join(' ')).toContain(text);
  });

  it('rejects a malformed account id', () => {
    expect(buildBillPreview(scan(), { accountId: "54' or 1=1" }).blockers.join(' ')).toContain('not a valid QuickBooks id');
  });

  it('omits optional fields that are missing and rounds the amount to cents', () => {
    const preview = buildBillPreview(scan({ data: { dueDate: null, invoiceNumber: null, total: 10.005 } }), { accountId: '54' });

    expect(preview.payload).not.toHaveProperty('DueDate');
    expect(preview.payload).not.toHaveProperty('DocNumber');
    expect((preview.payload as { Line: Array<{ Amount: number }> }).Line[0].Amount).toBe(10.01);
  });
});

describe('mergeNote', () => {
  it('appends on a new line, or starts the note when empty', () => {
    expect(mergeNote('first', 'second', 'append')).toBe('first\nsecond');
    expect(mergeNote('', ' only ', 'append')).toBe('only');
    expect(mergeNote(null, 'only', 'append')).toBe('only');
  });

  it('replaces when asked and never exceeds the QuickBooks limit', () => {
    expect(mergeNote('old', 'new', 'replace')).toBe('new');
    expect(mergeNote('x'.repeat(MAX_PRIVATE_NOTE), 'more', 'append')).toHaveLength(MAX_PRIVATE_NOTE);
  });
});

describe('multipart upload body', () => {
  it('carries the metadata part, the file bytes and a closing boundary', () => {
    const body = buildAttachableMultipart({
      boundary: 'B',
      fileName: 'inv "1".pdf',
      contentType: 'application/pdf',
      content: Buffer.from('%PDF-bytes'),
      refs: [{ type: 'Bill', id: '123' }],
    }).toString('utf8');

    expect(body.startsWith('--B\r\n')).toBe(true);
    expect(body).toContain('name="file_metadata_01"');
    expect(body).toContain('"AttachableRef":[{"EntityRef":{"type":"Bill","value":"123"}}]');
    expect(body).toContain('"FileName":"inv 1 .pdf"');
    expect(body).toContain('name="file_content_01"; filename="inv 1 .pdf"');
    expect(body).toContain('%PDF-bytes');
    expect(body.endsWith('\r\n--B--\r\n')).toBe(true);
  });

  it('cleans file names that could break a header', () => {
    expect(safeUploadName('a"b\r\nc/d\\e.pdf')).toBe('a b c d e.pdf');
    expect(safeUploadName('   ')).toBe('attachment');
  });
});
