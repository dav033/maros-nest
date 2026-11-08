import {
  buildInvoiceFileName,
  formatAmount,
  normalizeVendor,
  projectShortCode,
  withCounter,
} from './invoice-file-name';

describe('projectShortCode', () => {
  it('reduces a full lead number to its short code', () => {
    expect(projectShortCode('064P-0826')).toBe('064P');
    expect(projectShortCode('045-0726')).toBe('045');
    expect(projectShortCode('064p')).toBe('064P');
  });

  it('keeps other codes but strips anything unsafe', () => {
    expect(projectShortCode('ABC-12')).toBe('ABC-12');
    expect(projectShortCode('../x y')).toBe('XY');
    expect(projectShortCode('   ')).toBeNull();
  });
});

describe('normalizeVendor', () => {
  it.each([
    ['The Home Depot #4021', 'HomeDepot'],
    ['Home Depot', 'HomeDepot'],
    ['LION Plumbing Supply, Inc.', 'LionPlumbingSupply'],
    ['BOND PLUMBING SUPPLY, INC.', 'BondPlumbingSupply'],
    ['Pérez Hermanos LLC', 'PerezHermanos'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeVendor(input)).toBe(expected);
  });

  it('returns null when nothing meaningful is left', () => {
    expect(normalizeVendor('The Inc.')).toBeNull();
    expect(normalizeVendor('###')).toBeNull();
  });
});

describe('formatAmount', () => {
  it('uses two decimals, no thousands separator and implies USD', () => {
    expect(formatAmount(1250)).toBe('1250.00');
    expect(formatAmount(980.891)).toBe('980.89');
    expect(formatAmount(1234567.5, 'usd')).toBe('1234567.50');
  });

  it('appends any other currency and ignores the sign', () => {
    expect(formatAmount(10, 'eur')).toBe('10.00EUR');
    expect(formatAmount(-40.72)).toBe('40.72');
  });
});

describe('buildInvoiceFileName', () => {
  const base = { fileName: 'IMG_0042.jpg', contentType: 'image/jpeg' };

  it('builds the standard name, as in the spec example', () => {
    expect(
      buildInvoiceFileName({ ...base, project: '064P', vendor: 'Home Depot', amount: 1250, fileName: 'x.pdf', contentType: 'application/pdf' }),
    ).toEqual({ name: '064P-HomeDepot-1250.00.pdf', missing: [] });
  });

  it('takes the extension from the original file', () => {
    expect(buildInvoiceFileName({ ...base, project: '064P-0826', vendor: 'Lion Plumbing Supply Inc.', amount: 980.89 }).name).toBe(
      '064P-LionPlumbingSupply-980.89.jpg',
    );
  });

  it('reports every missing field instead of inventing a name', () => {
    expect(buildInvoiceFileName({ ...base, project: null, vendor: '  ', amount: undefined })).toEqual({
      name: null,
      missing: ['project', 'vendor', 'amount'],
    });
    expect(buildInvoiceFileName({ ...base, project: '064P', vendor: 'Lion', amount: Number.NaN }).missing).toEqual(['amount']);
  });

  it('accepts a zero amount as a real value', () => {
    expect(buildInvoiceFileName({ ...base, project: '064P', vendor: 'Lion', amount: 0 }).name).toBe('064P-Lion-0.00.jpg');
  });
});

describe('withCounter', () => {
  it('numbers a colliding name before the extension', () => {
    expect(withCounter('064P-HomeDepot-1250.00.pdf', 2)).toBe('064P-HomeDepot-1250.00-2.pdf');
    expect(withCounter('noextension', 3)).toBe('noextension-3');
  });
});
