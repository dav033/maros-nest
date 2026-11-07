/**
 * Google OAuth scopes requested when a person connects their Google account.
 * Kept narrow on purpose:
 *  - `drive.file` only reaches files and folders this app created, never the
 *    rest of the person's Drive.
 *  - `gmail.compose` is the smallest scope that allows creating drafts. The API
 *    code only ever creates drafts; nothing in Maros sends mail through it.
 */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const GOOGLE_CONNECT_SCOPES = [
  'openid',
  'email',
  CALENDAR_SCOPE,
  GMAIL_COMPOSE_SCOPE,
  DRIVE_FILE_SCOPE,
] as const;
