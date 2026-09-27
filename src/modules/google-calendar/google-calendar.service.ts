import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { Permission } from '../../common/auth/permissions';
import { Lead } from '../../entities/lead.entity';
import { Task } from '../../entities/task.entity';
import { TokenCryptoService } from '../quickbooks/services/core/token-crypto.service';
import {
  CreateGoogleCalendarMeetingDto,
  UpdateGoogleCalendarMeetingDto,
} from './dto/create-google-calendar-meeting.dto';
import { GoogleCalendarConnection } from './entities/google-calendar-connection.entity';
import {
  GoogleCalendarEntityKind,
  GoogleCalendarMeeting,
} from './entities/google-calendar-meeting.entity';

type GoogleCalendarMeetingResponse = Pick<
  GoogleCalendarMeeting,
  | 'id'
  | 'entityKind'
  | 'entityId'
  | 'title'
  | 'meetUrl'
  | 'calendarUrl'
  | 'startsAt'
  | 'endsAt'
  | 'attendees'
> & { isOrganizer: boolean };

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

@Injectable()
export class GoogleCalendarService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tokenCrypto: TokenCryptoService,
    @InjectRepository(GoogleCalendarConnection)
    private readonly connections: Repository<GoogleCalendarConnection>,
    @InjectRepository(GoogleCalendarMeeting)
    private readonly meetings: Repository<GoogleCalendarMeeting>,
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
  ) {
    this.clientId = this.config.get<string>('GOOGLE_CLIENT_ID') ?? '';
    this.clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET') ?? '';
    this.redirectUri =
      this.config.get<string>('GOOGLE_CALENDAR_REDIRECT_URI') ?? '';
  }

  getAuthorizationUrl(state: string): string {
    this.ensureOAuthConfigured();
    return this.newOAuthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent select_account',
      scope: ['openid', 'email', CALENDAR_SCOPE],
      state,
    });
  }

  async completeConnection(userId: number, code: string): Promise<void> {
    this.ensureOAuthConfigured();
    const client = this.newOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new BadRequestException(
        'Google did not return offline access. Reconnect and approve Calendar access.',
      );
    }

    client.setCredentials(tokens);
    const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    if (!data.email) {
      throw new BadRequestException('Google did not return an account email.');
    }

    await this.connections.save({
      userId,
      googleEmail: data.email.toLowerCase(),
      accessToken: this.tokenCrypto.encryptGoogle(tokens.access_token),
      refreshToken: this.tokenCrypto.encryptGoogle(tokens.refresh_token),
      expiresAt: new Date(
        tokens.expiry_date ?? Date.now() + 3600_000,
      ),
    });
  }

  async getConnection(
    userId: number,
  ): Promise<{ configured: boolean; connected: boolean; email?: string }> {
    if (!this.isOAuthConfigured()) return { configured: false, connected: false };
    const connection = await this.connections.findOneBy({ userId });
    return connection
      ? { configured: true, connected: true, email: connection.googleEmail }
      : { configured: true, connected: false };
  }

  async listMeetings(
    user: AuthenticatedUser,
    entityKind?: GoogleCalendarEntityKind,
    entityId?: number,
  ): Promise<GoogleCalendarMeetingResponse[]> {
    if (Boolean(entityKind) !== (entityId !== undefined)) {
      throw new BadRequestException('entityKind and entityId must be provided together.');
    }
    if (entityKind) this.requirePermission(user, entityKind, 'read');
    const query = this.meetings
      .createQueryBuilder('meeting')
      .where(
        '(meeting.user_id = :userId OR meeting.attendees @> CAST(:attendee AS jsonb))',
        { userId: user.id, attendee: JSON.stringify([user.email.toLowerCase()]) },
      );
    if (entityKind && entityId !== undefined) {
      query
        .andWhere('meeting.entity_kind = :entityKind', { entityKind })
        .andWhere('meeting.entity_id = :entityId', { entityId });
    }
    const meetings = await query.orderBy('meeting.starts_at', 'ASC').getMany();
    return meetings.map((meeting) => this.toMeetingResponse(meeting, user.id));
  }

  async createMeeting(
    user: AuthenticatedUser,
    dto: CreateGoogleCalendarMeetingDto,
  ): Promise<GoogleCalendarMeetingResponse> {
    if (Boolean(dto.entityKind) !== (dto.entityId !== undefined)) {
      throw new BadRequestException('entityKind and entityId must be provided together.');
    }
    if (dto.entityKind && dto.entityId !== undefined) {
      this.requirePermission(user, dto.entityKind, 'write');
      await this.ensureEntityExists(dto.entityKind, dto.entityId);
    }

    const start = new Date(dto.startsAt);
    const end = new Date(dto.endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      throw new BadRequestException('The meeting end must be after its start.');
    }
    if (end.getTime() - start.getTime() > 8 * 60 * 60 * 1000) {
      throw new BadRequestException('Meetings cannot be longer than 8 hours.');
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: dto.timeZone });
    } catch {
      throw new BadRequestException('A valid time zone is required.');
    }

    const title = dto.title.trim();
    if (!title) throw new BadRequestException('A meeting title is required.');

    const attendees = [...new Set((dto.attendees ?? []).map((email) => email.trim().toLowerCase()))];
    const client = await this.getAuthorizedClient(user.id);
    const calendar = google.calendar({ version: 'v3', auth: client });
    let googleEventId: string | undefined;

    try {
      const { data: created } = await calendar.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: 1,
        sendUpdates: 'none',
        requestBody: {
          summary: title,
          start: { dateTime: start.toISOString(), timeZone: dto.timeZone },
          end: { dateTime: end.toISOString(), timeZone: dto.timeZone },
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        },
      });
      googleEventId = created.id ?? undefined;
      if (!googleEventId) throw new BadGatewayException('Google did not return an event ID.');

      let event = created;
      let meetUrl = this.meetUrl(event);
      for (let attempt = 0; !meetUrl && attempt < 6; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        event = (await calendar.events.get({ calendarId: 'primary', eventId: googleEventId })).data;
        meetUrl = this.meetUrl(event);
      }
      if (!meetUrl) {
        throw new BadGatewayException('Google could not create the Meet link.');
      }

      const meeting = await this.meetings.save({
        userId: user.id,
        entityKind: dto.entityKind ?? null,
        entityId: dto.entityId ?? null,
        googleEventId,
        title,
        meetUrl,
        calendarUrl: event.htmlLink ?? null,
        startsAt: start,
        endsAt: end,
        attendees,
      });

      if (attendees.length) {
        await calendar.events.patch({
          calendarId: 'primary',
          eventId: googleEventId,
          conferenceDataVersion: 1,
          sendUpdates: 'all',
          requestBody: { attendees: attendees.map((email) => ({ email })) },
        });
      }
      return this.toMeetingResponse(meeting, user.id);
    } catch (error) {
      if (googleEventId) {
        await calendar.events
          .delete({ calendarId: 'primary', eventId: googleEventId, sendUpdates: 'all' })
          .catch(() => undefined);
        await this.meetings.delete({ userId: user.id, googleEventId }).catch(() => undefined);
      }
      if (error instanceof BadRequestException || error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException('Google Calendar could not create the meeting.');
    }
  }

  async updateMeeting(
    user: AuthenticatedUser,
    id: number,
    dto: UpdateGoogleCalendarMeetingDto,
  ): Promise<GoogleCalendarMeetingResponse> {
    const meeting = await this.meetings.findOneBy({ id, userId: user.id });
    if (!meeting) throw new NotFoundException('Meeting not found.');

    const start = dto.startsAt ? new Date(dto.startsAt) : meeting.startsAt;
    const end = dto.endsAt ? new Date(dto.endsAt) : meeting.endsAt;
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      throw new BadRequestException('The meeting end must be after its start.');
    }
    if (end.getTime() - start.getTime() > 8 * 60 * 60 * 1000) {
      throw new BadRequestException('Meetings cannot be longer than 8 hours.');
    }
    const timeZone = dto.timeZone ?? 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      throw new BadRequestException('A valid time zone is required.');
    }
    const title = dto.title?.trim() ?? meeting.title;
    if (!title) throw new BadRequestException('A meeting title is required.');
    const attendees = dto.attendees === undefined
      ? meeting.attendees
      : [...new Set(dto.attendees.map((email) => email.trim().toLowerCase()))];

    try {
      const calendar = google.calendar({
        version: 'v3',
        auth: await this.getAuthorizedClient(user.id),
      });
      const { data: event } = await calendar.events.patch({
        calendarId: 'primary',
        eventId: meeting.googleEventId,
        conferenceDataVersion: 1,
        sendUpdates: 'all',
        requestBody: {
          summary: title,
          start: { dateTime: start.toISOString(), timeZone },
          end: { dateTime: end.toISOString(), timeZone },
          attendees: attendees.map((email) => ({ email })),
        },
      });
      meeting.title = title;
      meeting.startsAt = start;
      meeting.endsAt = end;
      meeting.attendees = attendees;
      meeting.calendarUrl = event.htmlLink ?? meeting.calendarUrl;
      const saved = await this.meetings.save(meeting);
      return this.toMeetingResponse(saved, user.id);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadGatewayException('Google Calendar could not update the meeting.');
    }
  }

  async cancelMeeting(user: AuthenticatedUser, id: number): Promise<void> {
    const meeting = await this.meetings.findOneBy({ id, userId: user.id });
    if (!meeting) throw new NotFoundException('Meeting not found.');
    try {
      const calendar = google.calendar({
        version: 'v3',
        auth: await this.getAuthorizedClient(user.id),
      });
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: meeting.googleEventId,
        sendUpdates: 'all',
      });
      await this.meetings.delete({ id, userId: user.id });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadGatewayException('Google Calendar could not cancel the meeting.');
    }
  }

  private async ensureEntityExists(kind: GoogleCalendarEntityKind, id: number): Promise<void> {
    const exists =
      kind === 'lead'
        ? await this.leads.existsBy({ id })
        : await this.tasks.existsBy({ id });
    if (!exists) throw new NotFoundException(`${kind} not found.`);
  }

  private requirePermission(
    user: AuthenticatedUser,
    kind: GoogleCalendarEntityKind,
    action: 'read' | 'write',
  ): void {
    const permission = `${kind === 'lead' ? 'leads' : 'tasks'}:${action}` as Permission;
    if (!user.permissions.includes(permission)) {
      throw new ForbiddenException(`You need ${permission} permission.`);
    }
  }

  private async getAuthorizedClient(userId: number): Promise<InstanceType<typeof google.auth.OAuth2>> {
    const connection = await this.connections.findOneBy({ userId });
    if (!connection) throw new BadRequestException('Connect Google Calendar first.');

    const client = this.newOAuthClient();
    client.setCredentials({
      access_token: this.tokenCrypto.decryptGoogle(connection.accessToken),
      refresh_token: this.tokenCrypto.decryptGoogle(connection.refreshToken),
      expiry_date: connection.expiresAt.getTime(),
    });
    if (connection.expiresAt.getTime() <= Date.now() + EXPIRY_BUFFER_MS) {
      try {
        await client.getAccessToken();
        const tokens = client.credentials;
        if (!tokens.access_token) throw new Error('Missing refreshed access token');
        connection.accessToken = this.tokenCrypto.encryptGoogle(tokens.access_token);
        connection.refreshToken = this.tokenCrypto.encryptGoogle(
          tokens.refresh_token ?? this.tokenCrypto.decryptGoogle(connection.refreshToken),
        );
        connection.expiresAt = new Date(tokens.expiry_date ?? Date.now() + 3600_000);
        await this.connections.save(connection);
      } catch {
        throw new BadRequestException('Reconnect Google Calendar and try again.');
      }
    }
    return client;
  }

  private meetUrl(event: { hangoutLink?: string | null; conferenceData?: { entryPoints?: Array<{ entryPointType?: string | null; uri?: string | null }> | null } | null }): string | null {
    return event.hangoutLink ??
      event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri ??
      null;
  }

  private toMeetingResponse(
    meeting: GoogleCalendarMeeting,
    userId: number,
  ): GoogleCalendarMeetingResponse {
    return {
      id: meeting.id,
      entityKind: meeting.entityKind,
      entityId: meeting.entityId,
      title: meeting.title,
      meetUrl: meeting.meetUrl,
      calendarUrl: meeting.calendarUrl,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      attendees: meeting.attendees,
      isOrganizer: meeting.userId === userId,
    };
  }

  private newOAuthClient(): InstanceType<typeof google.auth.OAuth2> {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
  }

  private ensureOAuthConfigured(): void {
    if (!this.isOAuthConfigured()) {
      throw new BadRequestException(
        'Google Calendar OAuth or token encryption is not configured.',
      );
    }
  }

  private isOAuthConfigured(): boolean {
    return Boolean(
      this.clientId &&
        this.clientSecret &&
        this.redirectUri &&
        this.config.get<string>('GOOGLE_TOKEN_ENCRYPTION_KEY'),
    );
  }
}
