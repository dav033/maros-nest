import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  CreateGoogleCalendarMeetingDto,
  UpdateGoogleCalendarMeetingDto,
} from './dto/create-google-calendar-meeting.dto';
import type { GoogleCalendarEntityKind } from './entities/google-calendar-meeting.entity';
import { GoogleCalendarService } from './google-calendar.service';

const STATE_COOKIE = 'maros_google_calendar_oauth_state';
const RETURN_TO_COOKIE = 'maros_google_calendar_return_to';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(
    private readonly service: GoogleCalendarService,
    private readonly config: ConfigService,
  ) {}

  @Get('connection')
  getConnection(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.service.getConnection(user.id);
  }

  @Get('connect')
  connect(
    @Query('returnTo') returnTo: string | undefined,
    @Res() response: Response,
  ): void {
    const state = randomBytes(32).toString('hex');
    const secure = process.env.NODE_ENV === 'production';
    response.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: STATE_MAX_AGE_MS,
    });
    response.cookie(RETURN_TO_COOKIE, this.safeReturnPath(returnTo), {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: STATE_MAX_AGE_MS,
    });
    response.redirect(this.service.getAuthorizationUrl(state));
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: Request,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const cookies = this.readCookies(request);
    const expectedState = cookies[STATE_COOKIE];
    const returnPath = this.safeReturnPath(cookies[RETURN_TO_COOKIE]);
    this.clearOauthCookies(response);

    if (!user) throw new UnauthorizedException();
    if (!code || !state || !expectedState || state !== expectedState) {
      response.redirect(this.frontendUrl(returnPath, 'error'));
      return;
    }

    try {
      await this.service.completeConnection(user.id, code);
      response.redirect(this.frontendUrl(returnPath, 'connected'));
    } catch {
      response.redirect(this.frontendUrl(returnPath, 'error'));
    }
  }

  @Get('meetings')
  getMeetings(
    @Query('entityKind') entityKind: string | undefined,
    @Query('entityId') entityIdValue: string | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) throw new UnauthorizedException();
    if (Boolean(entityKind) !== Boolean(entityIdValue)) {
      throw new BadRequestException('entityKind and entityId must be provided together.');
    }
    if (entityKind && entityKind !== 'lead' && entityKind !== 'task') {
      throw new BadRequestException('entityKind must be lead or task.');
    }
    const entityId = entityIdValue === undefined ? undefined : Number(entityIdValue);
    if (entityId !== undefined && (!Number.isInteger(entityId) || entityId < 1)) {
      throw new BadRequestException('entityId must be a positive integer.');
    }
    return this.service.listMeetings(
      user,
      entityKind as GoogleCalendarEntityKind | undefined,
      entityId,
    );
  }

  @Post('meetings')
  createMeeting(
    @Body() dto: CreateGoogleCalendarMeetingDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.service.createMeeting(user, dto);
  }

  @Patch('meetings/:id')
  updateMeeting(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGoogleCalendarMeetingDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.service.updateMeeting(user, id, dto);
  }

  @Delete('meetings/:id')
  cancelMeeting(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    if (!user) throw new UnauthorizedException();
    return this.service.cancelMeeting(user, id);
  }

  private safeReturnPath(value?: string): string {
    const fallback = '/tasks';
    if (!value?.startsWith('/')) return fallback;
    const baseUrl = this.config.get<string>('TASK_APP_URL') ?? 'http://localhost:3000';
    try {
      const base = new URL(baseUrl);
      const target = new URL(value, base);
      return target.origin === base.origin
        ? `${target.pathname}${target.search}${target.hash}`
        : fallback;
    } catch {
      return fallback;
    }
  }

  private frontendUrl(returnPath: string, result: 'connected' | 'error'): string {
    const baseUrl = this.config.get<string>('TASK_APP_URL') ?? 'http://localhost:3000';
    const target = new URL(returnPath, baseUrl);
    target.searchParams.set('googleCalendar', result);
    return target.toString();
  }

  private readCookies(request: Request): Record<string, string> {
    return Object.fromEntries(
      (request.headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const separator = part.indexOf('=');
          return [
            part.slice(0, separator),
            decodeURIComponent(part.slice(separator + 1)),
          ];
        }),
    );
  }

  private clearOauthCookies(response: Response): void {
    const secure = process.env.NODE_ENV === 'production';
    for (const name of [STATE_COOKIE, RETURN_TO_COOKIE]) {
      response.clearCookie(name, { path: '/', secure, sameSite: 'lax' });
    }
  }
}
