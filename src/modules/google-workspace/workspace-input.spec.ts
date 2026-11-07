import {
  decodeBase64,
  driveQueryLiteral,
  extensionFor,
  hasLineBreak,
  safeName,
} from './workspace-input';

describe('safeName', () => {
  it('removes path separators, control characters and leading dots', () => {
    expect(safeName('../../etc/passwd')).toBe('etc-passwd');
    expect(safeName('a\r\nb')).toBe('a b');
    expect(safeName('.hidden')).toBe('hidden');
  });

  it('falls back when nothing usable is left and caps the length', () => {
    expect(safeName('  ///  ')).toBe('untitled');
    expect(safeName('...', 'fallback')).toBe('fallback');
    expect(safeName('x'.repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe('driveQueryLiteral', () => {
  it('escapes quotes and backslashes so a name cannot break out of the query', () => {
    expect(driveQueryLiteral("O'Brien")).toBe("'O\\'Brien'");
    expect(driveQueryLiteral("a' or name contains '")).toBe("'a\\' or name contains \\''");
    expect(driveQueryLiteral('back\\slash')).toBe("'back\\\\slash'");
  });
});

describe('decodeBase64', () => {
  it('decodes standard and url-safe base64', () => {
    expect(decodeBase64(Buffer.from('hola mundo').toString('base64'), 100).toString()).toBe('hola mundo');
    expect(decodeBase64(Buffer.from([251, 255]).toString('base64url'), 100)).toEqual(Buffer.from([251, 255]));
  });

  it('rejects text that is not base64, empty content and oversize files', () => {
    expect(() => decodeBase64('esto no es base64!!', 100)).toThrow(/base64/);
    expect(() => decodeBase64('', 100)).toThrow();
    expect(() => decodeBase64(Buffer.alloc(11).toString('base64'), 10)).toThrow(/máximo/);
  });
});

describe('extensionFor / hasLineBreak', () => {
  it('prefers the file name extension, then the content type', () => {
    expect(extensionFor('scan.PDF', null)).toBe('pdf');
    expect(extensionFor('scan', 'image/jpeg')).toBe('jpg');
    expect(extensionFor('scan', null)).toBe('bin');
  });

  it('detects header-injection line breaks', () => {
    expect(hasLineBreak('Hola\r\nBcc: x@y.com')).toBe(true);
    expect(hasLineBreak('Hola')).toBe(false);
  });
});
