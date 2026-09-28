import { QuickbooksNormalizerService } from './quickbooks-normalizer.service';

/**
 * Importes que QuickBooks no expone para esa entidad (verificado contra la API
 * real: responde 400 "Property X not found for Entity Y"). El normalizador no
 * puede inventarlos, pero tampoco puede darlos por cero: un asiento sin importe
 * conocido se dibujaria como un asiento que no mueve dinero.
 */
describe('QuickbooksNormalizerService — importes desconocidos', () => {
  const normalizer = new QuickbooksNormalizerService();

  it('deja el total de JournalEntry en null, no en 0 (QBO no expone TotalAmt)', () => {
    const journalEntry = normalizer.normalizeJournalEntry({
      Id: '77',
      TxnDate: '2026-09-01',
      Line: [{ Amount: 105.93, DetailType: 'JournalEntryLineDetail' }],
    });

    expect(journalEntry.totalAmount).toBeNull();
    expect(journalEntry.warnings.map((w) => w.code)).toContain('TOTAL_AMOUNT_UNAVAILABLE');
  });

  it('respeta el TotalAmt de JournalEntry si algun dia QBO lo devuelve', () => {
    expect(
      normalizer.normalizeJournalEntry({ Id: '77', TotalAmt: 105.93, Line: [] }).totalAmount,
    ).toBe(105.93);
  });

  it('omite el saldo de VendorCredit, no lo pone en 0 (QBO no expone Balance)', () => {
    const vendorCredit = normalizer.normalizeVendorCredit({
      Id: '88',
      TotalAmt: 250,
      Line: [],
    });

    expect(vendorCredit.openBalance).toBeUndefined();
    expect(vendorCredit.totalAmount).toBe(250);
  });

  it('mantiene en 0 los importes que QBO si devuelve como 0', () => {
    const invoice = normalizer.normalizeInvoice({ Id: '1', TotalAmt: 0, Balance: 0, Line: [] });
    expect(invoice.totalAmount).toBe(0);
    expect(invoice.openBalance).toBe(0);
  });
});
