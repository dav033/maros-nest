import {
  findQboCustomerForProject,
  mapQboCustomersToProjects,
  matchesProjectNumber,
} from './quickbooks-financials.helpers';

describe('QuickBooks project matching', () => {
  it('matches complete project-number tokens across QBO naming conventions', () => {
    expect(
      matchesProjectNumber('001-0726', '[001-0726] Customer address'),
    ).toBe(true);
    expect(
      matchesProjectNumber('001-0726', '001-0726 - Customer address'),
    ).toBe(true);
    expect(matchesProjectNumber('001-0726', 'Customer 001-0726')).toBe(true);
    expect(
      matchesProjectNumber('022-0325', '022 -0325 - Customer address'),
    ).toBe(true);
  });

  it('does not match a project number embedded in a larger token', () => {
    expect(matchesProjectNumber('001-0726', '1001-0726 Customer')).toBe(false);
    expect(matchesProjectNumber('001-0726', '001-07260 Customer')).toBe(false);
  });

  it('reads a change order in the spellings QBO jobs are typed with', () => {
    expect(
      matchesProjectNumber('001R-0625 CO01', '001R-0625 C01, 3324 NW 14th St'),
    ).toBe(true);
    expect(
      matchesProjectNumber('020P-0725 CO01', '020P-0725 CO1 2100 NE 15th St'),
    ).toBe(true);
    expect(
      matchesProjectNumber(
        '020P-0725 CO01',
        '020P-0725 CO-01, Customer address',
      ),
    ).toBe(true);
    expect(
      matchesProjectNumber(
        '020P-0725 CO01',
        '[020P-0725 CO 1] Customer address',
      ),
    ).toBe(true);
  });

  it('never resolves a base project number against its own change order', () => {
    expect(
      matchesProjectNumber('001R-0625', '001R-0625, 3324 NW 14th St'),
    ).toBe(true);
    expect(
      matchesProjectNumber('001R-0625', '001R-0625 C01, 3324 NW 14th St'),
    ).toBe(false);
    expect(
      matchesProjectNumber('001R-0625', '001R-0625 CO01, 3324 NW 14th St'),
    ).toBe(false);
    // A trailing letter is part of the number, not a change-order marker.
    expect(
      matchesProjectNumber('001C-0625', '001C-0625, 3324 NW 14th St'),
    ).toBe(true);
    // A street number is not a change order either — the same names
    // quickbooks-import-diagnostics reads as base contracts, so a job whose
    // address starts with a C must still resolve to its own project.
    expect(
      matchesProjectNumber('001R-0625', '001R-0625 C0123 Main St'),
    ).toBe(true);
    expect(
      matchesProjectNumber('001R-0625', '001R-0625, C0123 Main St'),
    ).toBe(true);
    expect(matchesProjectNumber('020P-0725', '020P-0725 C12 Ave')).toBe(true);
  });

  it('keeps a base contract and its change order on separate QBO jobs', () => {
    const matches = mapQboCustomersToProjects(
      ['001R-0625', '001R-0625 CO01'],
      [
        { Id: '283', DisplayName: '001R-0625 C01, 3324 NW 14th St, Miami, FL' },
        { Id: '387', DisplayName: '001R-0625, 3324 NW 14th St, Miami, FL' },
      ],
    );

    expect(matches.get('001R-0625')?.Id).toBe('387');
    expect(matches.get('001R-0625 CO01')?.Id).toBe('283');
  });

  it('escapes project-number punctuation and prefers a leading match', () => {
    const customers = [
      { Id: 'nested', DisplayName: 'Customer note 020P-0725 CO01' },
      { Id: 'leading', DisplayName: '020P-0725 CO01, Customer address' },
    ];

    expect(findQboCustomerForProject('020P-0725 CO01', customers)?.Id).toBe(
      'leading',
    );
  });

  it('maps a change-order job to the longest matching CRM project number', () => {
    const matches = mapQboCustomersToProjects(
      ['020P-0725', '020P-0725 CO01'],
      [
        { Id: 'nested', DisplayName: 'Customer note 020P-0725' },
        { Id: 'co01', DisplayName: '020P-0725 CO01 2100 NE 15th St' },
        { Id: 'base', DisplayName: '020P-0725, 2100 NE 15th St' },
      ],
    );

    expect(matches.get('020P-0725 CO01')?.Id).toBe('co01');
    expect(matches.get('020P-0725')?.Id).toBe('base');
  });
});
