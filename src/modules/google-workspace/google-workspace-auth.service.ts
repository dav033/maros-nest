import { BadRequestException, Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';

export type GoogleOAuthClient = InstanceType<typeof google.auth.OAuth2>;

/**
 * Hands out the connected Google account of a Maros user and checks that the
 * connection really carries the scope an operation needs. People who connected
 * Google Calendar before Gmail and Drive were added hold a token without those
 * scopes; they have to reconnect once, and the message says so instead of
 * surfacing a bare 403 from Google.
 */
@Injectable()
export class GoogleWorkspaceAuthService {
  constructor(private readonly calendar: GoogleCalendarService) {}

  /** Same as clientWithScope, but any one of `scopes` is enough; says which one the token has. */
  async clientWithAnyScope(
    userId: number,
    scopes: string[],
  ): Promise<{ client: GoogleOAuthClient; granted: string }> {
    const client = await this.calendar.getAuthorizedClient(userId);
    const accessToken = client.credentials.access_token;
    const info = accessToken ? await client.getTokenInfo(accessToken).catch(() => null) : null;
    const granted = info ? scopes.find((scope) => info.scopes.includes(scope)) : undefined;
    if (!granted) {
      throw new BadRequestException(
        'GOOGLE_RECONNECT_REQUIRED: this Google connection does not include the Gmail or Drive access this needs. ' +
          'Reconnect Google from Maros and approve the new permissions.',
      );
    }
    return { client, granted };
  }

  async clientWithScope(userId: number, scope: string): Promise<GoogleOAuthClient> {
    const client = await this.calendar.getAuthorizedClient(userId);
    const accessToken = client.credentials.access_token;
    if (!accessToken) {
      throw new BadRequestException('GOOGLE_RECONNECT_REQUIRED: reconnect Google and try again.');
    }
    const info = await client.getTokenInfo(accessToken).catch(() => null);
    if (!info || !info.scopes.includes(scope)) {
      throw new BadRequestException(
        'GOOGLE_RECONNECT_REQUIRED: this Google connection does not include Gmail and Drive access. ' +
          'Reconnect Google from Maros and approve the new permissions.',
      );
    }
    return client;
  }
}
