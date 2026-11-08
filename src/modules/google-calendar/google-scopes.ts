/**
 * Google OAuth scopes requested when a person connects their Google account.
 *  - `drive.file` lets the app create files and folders (and later read what it
 *    created). All Drive WRITES go through it, so nothing existing is modified.
 *  - `drive.readonly` and `gmail.readonly` let the app read any file / message
 *    (search Drive, attach any Drive file, import invoices from a mail label).
 *    They cannot change or delete anything.
 *  - `gmail.compose` is the smallest scope that allows creating drafts. The API
 *    code only ever creates drafts; nothing in Maros sends mail through it.
 */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Read-only: list and read any Gmail message / any Drive file. Neither can change or delete anything. */
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export const GOOGLE_CONNECT_SCOPES = [
  'openid',
  'email',
  CALENDAR_SCOPE,
  GMAIL_COMPOSE_SCOPE,
  DRIVE_FILE_SCOPE,
  GMAIL_READONLY_SCOPE,
  DRIVE_READONLY_SCOPE,
] as const;
