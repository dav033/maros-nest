import { parseInvoiceExtraction } from './invoice-extraction.parser';

const valid = {
  direction: 'incoming',
  classification: 'materials_expense',
  counterparty_name: 'Lion Plumbing Supply Inc.',
  invoice_number: 4022039,
  issue_date: '2026-09-01',
  due_date: null,
  currency: '$',
  subtotal: 80,
  tax_total: 7.73,
  total: 87.73,
  payment_status: 'unpaid',
  confidence: 0.91,
  project_number: '076',
  line_items: [{ description: 'Pipe', quantity: 1, unit_price: 80, amount: 80 }],
};

describe('parseInvoiceExtraction', () => {
  it('maps a well-formed response without warnings', () => {
    const result = parseInvoiceExtraction(valid);
    expect(result.warnings).toEqual([]);
    expect(result.projectNumberHint).toBe('076');
    expect(result.data).toMatchObject({
      direction: 'incoming',
      counterpartyName: 'Lion Plumbing Supply Inc.',
      invoiceNumber: '4022039',
      currency: 'USD',
      total: 87.73,
      lineItems: [{ description: 'Pipe', quantity: 1, unitPrice: 80, amount: 80 }],
    });
  });

  it('nulls bad fields and explains each one instead of failing', () => {
    const result = parseInvoiceExtraction({
      ...valid,
      direction: 'sideways',
      issue_date: '09/01/2026',
      total: -5,
      confidence: 0.2,
      line_items: [{ description: 'Pipe', amount: 80 }, 'garbage', { description: '' }],
    });

    expect(result.data.direction).toBe('unknown');
    expect(result.data.issueDate).toBeNull();
    expect(result.data.total).toBeNull();
    expect(result.data.lineItems).toEqual([
      { description: 'Pipe', quantity: null, unitPrice: null, amount: 80 },
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Document type'),
        expect.stringContaining('Issue date "09/01/2026"'),
        expect.stringContaining('Total could not be read'),
        expect.stringContaining('2 line items'),
        expect.stringContaining('Low extraction confidence (20%)'),
      ]),
    );
  });

  it('flags a total that does not match subtotal plus tax', () => {
    const result = parseInvoiceExtraction({ ...valid, total: 100 });
    expect(result.warnings).toEqual([expect.stringContaining('does not add up')]);
  });

  it('handles a non-object payload', () => {
    const result = parseInvoiceExtraction('nope');
    expect(result.data.total).toBeNull();
    expect(result.warnings[0]).toContain('no readable fields');
  });
});
