/**
 * Input rules for the Gmail/Drive operations. The MCP calls the services
 * directly (no Nest ValidationPipe), so these are the only checks that run:
 * everything that reaches Google has been through here first.
 */

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_REPORT_BYTES = 10 * 1024 * 1024;
export const MAX_FOLDER_DEPTH = 4;

/** Drive folders live under this root, created by the app in My Drive. */
export const DRIVE_ROOT_FOLDER = 'Maros';

export const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Replaces ASCII control characters (including CR and LF) with a space. */
function stripControlChars(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? ' ' : char;
  }
  return out;
}

/** A file or folder name that is safe to hand to Drive and to put in a header. */
export function safeName(value: string, fallback = 'untitled'): string {
  const cleaned = stripControlChars(value)
    .replace(/\.{2,}/g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\-\s]+/, '')
    .slice(0, 120)
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

export function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

/** Escapes a value for a Drive `q` string literal. */
export function driveQueryLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function extensionFor(fileName: string, contentType: string | null): string {
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  switch (contentType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

/** Decodes standard or URL-safe base64 and refuses anything that is not base64. */
export function decodeBase64(value: string, maxBytes: number): Buffer {
  const compact = value.replace(/\s+/g, '');
  if (compact.length === 0 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    throw new Error('El contenido no es base64 válido.');
  }
  const buffer = Buffer.from(compact.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buffer.length === 0) throw new Error('El contenido está vacío.');
  if (buffer.length > maxBytes) {
    throw new Error(`El archivo supera el máximo de ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }
  return buffer;
}
