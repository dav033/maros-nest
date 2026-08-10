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
