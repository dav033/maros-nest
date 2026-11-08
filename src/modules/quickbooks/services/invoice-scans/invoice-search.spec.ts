import type { InvoiceScan } from '../../entities/invoice-scan.entity';
import {
  attachLocations,
  buildSearchReport,
  projectMatches,
  vendorMatches,
} from './invoice-search';

const url = (id: string) => `https://app.test/finance/invoices/${id}`;

function scan(overrides: {
  id: string;
  projectNumber?: string | null;
  vendor?: string | null;
  fileName?: string;
  total?: number | null;
  issueDate?: string | null;
  fileKey?: string | null;
  enteredAt?: Date | null;
  status?: InvoiceScan['status'];
  createdAt?: Date;
}): InvoiceScan {
  return {
    id: overrides.id,
    recordType: 'invoice',
    fileKey: overrides.fileKey === undefined ? `invoice-scans/${overrides.id}.pdf` : overrides.fileKey,
    fileName: overrides.fileName ?? `${overrides.id}.pdf`,
    contentType: 'application/pdf',
    status: overrides.status ?? 'needs_review',
    extractedData: {
      direction: 'incoming',
      classification: 'materials_expense',
      counterpartyName: overrides.vendor ?? null,
      invoiceNumber: `INV-${overrides.id}`,
      issueDate: overrides.issueDate === undefined ? '2026-09-10' : overrides.issueDate,
      dueDate: null,
      currency: 'USD',
      subtotal: null,
      taxTotal: null,
      total: overrides.total === undefined ? 100 : overrides.total,
      paymentStatus: 'unknown',
      confidence: 0.9,
      lineItems: [],
    },
    qboSuggestions: {},
    errorMessage: null,
    projectNumber: overrides.projectNumber === undefined ? '064P-0826' : overrides.projectNumber,
    warnings: [],
    enteredAt: overrides.enteredAt ?? null,
    enteredBy: null,
    updatedBy: null,
    comments: null,
    notifiedAt: null,
    remindedAt: null,
    createdAt: overrides.createdAt ?? new Date('2026-09-11T10:00:00Z'),
    updatedAt: new Date('2026-09-11T10:00:00Z'),
  } as unknown as InvoiceScan;
}

describe('projectMatches', () => {
  it('matches the short number against full numbers, case-insensitively', () => {
    expect(projectMatches('064P', '064P-0826')).toBe(true);
    expect(projectMatches('064p', '064P-0127')).toBe(true);
    expect(projectMatches('064P', '064P')).toBe(true);
  });

  it('does not confuse neighbouring projects', () => {
    expect(projectMatches('064P', '064-0826')).toBe(false);
    expect(projectMatches('064', '064P-0826')).toBe(false);
    expect(projectMatches('06', '064P-0826')).toBe(false);
    expect(projectMatches('064P', null)).toBe(false);
  });

  it('a full number selects only itself', () => {
    expect(projectMatches('064P-0826', '064P-0826')).toBe(true);
    expect(projectMatches('064P-0826', '064P-0127')).toBe(false);
  });
});

describe('vendorMatches', () => {
  it('matches how people name vendors', () => {
    expect(vendorMatches('Home Depot', 'The Home Depot #4021', 'x.pdf')).toBe(true);
    expect(vendorMatches('lion', 'LION Electric LLC', 'x.pdf')).toBe(true);
    expect(vendorMatches('Bond', 'Bond Plumbing Supply', 'x.pdf')).toBe(true);
  });

  it('matches whole words, not substrings', () => {
    expect(vendorMatches('Bond', 'Bonds & Co', 'x.pdf')).toBe(false);
    expect(vendorMatches('Home Depot', 'Home Warehouse', 'x.pdf')).toBe(false);
  });

  it('ignores accents and falls back to the file name without a counterparty', () => {
    expect(vendorMatches('Perez', 'Pérez Hermanos', 'x.pdf')).toBe(true);
    expect(vendorMatches('Lion', null, 'Lion-064P-invoice.pdf')).toBe(true);
    expect(vendorMatches('Lion', null, 'other.pdf')).toBe(false);
  });

  it('never matches an empty or legal-words-only query', () => {
    expect(vendorMatches('', 'Lion', 'x.pdf')).toBe(false);
    expect(vendorMatches('The Inc', 'The Inc', 'x.pdf')).toBe(false);
  });
});

describe('buildSearchReport: project 064P with Lion, Bond and Home Depot', () => {
  const input = {
    projects: ['064P'],
    vendors: ['Lion', 'Bond', 'Home Depot'],
  };

  it('returns the matching documents with links and flags the vendor with none', () => {
    const scans = [
      scan({ id: 'a', vendor: 'Lion Electric', total: 250.5 }),
      scan({ id: 'b', vendor: 'The Home Depot', total: 99.5, enteredAt: new Date() }),
      scan({ id: 'c', vendor: 'Home Depot', total: 10 }),
      scan({ id: 'z', vendor: 'Other Supplier', total: 5 }),
    ];

    const report = buildSearchReport(input, scans, [], url);

    const byVendor = Object.fromEntries(
      report.results.map((group) => [group.vendor, group.documents.map((doc) => doc.id)]),
    );
    expect(byVendor).toEqual({ Lion: ['a'], Bond: [], 'Home Depot': ['b', 'c'] });
    expect(report.results[0].documents[0].url).toBe(url('a'));
    expect(report.missing.map((item) => item.vendor)).toEqual(['Bond']);
    expect(report.summary).toMatchObject({
      documents: 3,
      requestedPairs: 3,
      foundPairs: 2,
      missingPairs: 1,
      totalsByCurrency: { USD: 360 },
    });
  });

  it('suggests unassigned documents of the missing vendor as candidates', () => {
    const report = buildSearchReport(
      input,
      [scan({ id: 'a', vendor: 'Lion' }), scan({ id: 'b', vendor: 'Home Depot' })],
      [
        scan({ id: 'u1', projectNumber: null, vendor: 'Bond Plumbing' }),
        scan({ id: 'u2', projectNumber: null, vendor: 'Someone Else' }),
      ],
      url,
    );

    expect(report.missing).toHaveLength(1);
    expect(report.missing[0].possibleUnassigned.map((doc) => doc.id)).toEqual(['u1']);
  });

  it('flags documents that need attention', () => {
    const report = buildSearchReport(
      { projects: ['064P'], vendors: ['Lion'] },
      [scan({ id: 'a', vendor: 'Lion', fileKey: null, total: null, issueDate: null })],
      [],
      url,
    );

    expect(report.results[0].documents[0].issues).toEqual(
      expect.arrayContaining(['no_file', 'no_total', 'no_date', 'not_entered_in_quickbooks']),
    );
  });
});

describe('buildSearchReport: filters', () => {
  it('lists every vendor when none is requested', () => {
    const report = buildSearchReport(
      { projects: ['064P'], vendors: [] },
      [scan({ id: 'a', vendor: 'Lion' }), scan({ id: 'b', vendor: 'Bond' })],
      [],
      url,
    );

    expect(report.results).toHaveLength(1);
    expect(report.results[0].vendor).toBeNull();
    expect(report.results[0].documents).toHaveLength(2);
    expect(report.missing).toEqual([]);
  });

  it('applies the date range on the invoice date', () => {
    const scans = [
      scan({ id: 'old', vendor: 'Lion', issueDate: '2026-07-01' }),
      scan({ id: 'new', vendor: 'Lion', issueDate: '2026-09-15' }),
    ];

    const report = buildSearchReport(
      { projects: ['064P'], vendors: ['Lion'], dateFrom: '2026-09-01', dateTo: '2026-09-30' },
      scans,
      [],
      url,
    );

    expect(report.results[0].documents.map((doc) => doc.id)).toEqual(['new']);
  });

  it('falls back to the upload day when the invoice has no date', () => {
    const report = buildSearchReport(
      { projects: ['064P'], vendors: [], dateFrom: '2026-09-01' },
      [scan({ id: 'nodate', vendor: 'Lion', issueDate: null, createdAt: new Date('2026-09-20T00:00:00Z') })],
      [],
      url,
    );

    expect(report.results[0].documents.map((doc) => doc.id)).toEqual(['nodate']);
  });

  it('keeps each project separate and does not double count a document', () => {
    const scans = [
      scan({ id: 'a', projectNumber: '064P-0826', vendor: 'Lion', total: 10 }),
      scan({ id: 'b', projectNumber: '070-0926', vendor: 'Lion', total: 20 }),
    ];

    const report = buildSearchReport(
      { projects: ['064P', '070', '064P-0826'], vendors: ['Lion'] },
      scans,
      [],
      url,
    );

    expect(report.results.map((group) => [group.project, group.documents.map((d) => d.id)])).toEqual([
      ['064P', ['a']],
      ['070', ['b']],
      ['064P-0826', ['a']],
    ]);
    expect(report.summary.documents).toBe(2);
    expect(report.summary.totalsByCurrency).toEqual({ USD: 30 });
  });
});

describe('attachLocations', () => {
  const location = {
    status: 'in_receipts',
    driveUrl: 'https://drive/1',
    driveName: '064P-Lion-980.89.pdf',
    driveFolder: 'Maros/Receipts/064P-0826',
    receivedAt: new Date('2026-11-08T10:00:00Z'),
    updatedAt: new Date('2026-11-08T10:00:00Z'),
  };

  it('adds the Drive locations to every document, including unassigned candidates', () => {
    const report = buildSearchReport(
      { projects: ['064P'], vendors: ['Lion', 'Bond'] },
      [scan({ id: 'a', vendor: 'Lion' })],
      [scan({ id: 'u1', projectNumber: null, vendor: 'Bond Plumbing' })],
      url,
    );
    expect(report.results[0].documents[0].locations).toEqual([]);

    attachLocations(report, new Map([['a', [location]], ['u1', [{ ...location, status: 'moved' }]]]));

    expect(report.results[0].documents[0].locations).toEqual([location]);
    expect(report.missing[0].possibleUnassigned[0].locations[0].status).toBe('moved');
  });

  it('leaves documents without a recorded location with an empty list', () => {
    const report = buildSearchReport({ projects: ['064P'], vendors: [] }, [scan({ id: 'a', vendor: 'Lion' })], [], url);

    attachLocations(report, new Map());

    expect(report.results[0].documents[0].locations).toEqual([]);
  });
});
