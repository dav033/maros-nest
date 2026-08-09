import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { jwtVerify } from 'jose';
import {
  NoteShareLinkExpiredException,
  NoteShareLinkNotFoundException,
  NoteShareLinkPasswordRequiredException,
} from '../../../../common/exceptions';
import { NoteLinksRepository } from '../../note-management/repositories/note-links.repository';
import { hashShareToken } from '../services/share-token.util';
import {
  RequestWithShareLink,
  SHARE_UNLOCK_HEADER,
  SKIP_LINK_PASSWORD_KEY,
  shareUnlockCookieName,
} from './share-link-context';

/**
 * The only door into a note from outside the CRM.
 *
 * Same shape as IntakeTokenGuard — a shared secret standing in for a session — but with
 * one important difference: the secret here is per note and revocable, so a leak costs
 * one document rather than the whole intake endpoint.
 *
 * Routes behind it must also be @Public(), or the global SessionAuthGuard rejects them
 * before this ever runs.
 *
 * ## What each failure says
 *
 * Unknown token, revoked link, and a link whose note is in the trash all answer an
 * identical 404: distinguishing them would let someone with an old URL learn whether the
 * note still exists. Expiry is the deliberate exception — a 410 tells a reader who had a
 * legitimate link that it aged out, which reveals nothing they did not already know.
 */
@Injectable()
export class NoteShareLinkGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly links: NoteLinksRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithShareLink>();
    const token = request.params?.token;
    if (!token) throw new NoteShareLinkNotFoundException();

    const link = await this.links.findByTokenHash(hashShareToken(token));
    if (!link || link.revokedAt) throw new NoteShareLinkNotFoundException();

    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
      throw new NoteShareLinkExpiredException();
    }

    // Trashing a note takes it off the internet without burning the URL: restore it and
    // the same link works again. Deliberate — a mis-click must not force everyone who
    // holds the link to be sent a new one.
    if (!link.page || link.page.deletedAt) {
      throw new NoteShareLinkNotFoundException();
    }

    if (link.passwordHash && !this.skipsPasswordCheck(context)) {
      const unlocked = await this.hasValidUnlockCookie(request, link.id);
      if (!unlocked) throw new NoteShareLinkPasswordRequiredException();
    }

    request.shareLink = link;
    return true;
  }

  private skipsPasswordCheck(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(SKIP_LINK_PASSWORD_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  /**
   * The unlock proof names one link id and is re-verified here rather than trusted: a
   * JWT minted for a different, unprotected link must not open this one.
   *
   * Header first, then cookie: the Next reader replays it as a header because the two
   * hosts need not be same-site, while a browser hitting this API directly still gets
   * the cookie path.
   */
  private async hasValidUnlockCookie(
    request: RequestWithShareLink,
    linkId: number,
  ): Promise<boolean> {
    const header = request.headers[SHARE_UNLOCK_HEADER];
    const token =
      (typeof header === 'string' && header) ||
      this.readCookie(request, shareUnlockCookieName(linkId));
    if (!token) return false;

    const secret = this.configService.get<string>('AUTH_SECRET');
    if (!secret) return false;

    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      return payload.linkId === linkId;
    } catch {
      return false;
    }
  }

  private readCookie(request: RequestWithShareLink, name: string): string | null {
    const header = request.headers['cookie'];
    if (!header) return null;

    for (const part of header.split(';')) {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) continue;
      if (part.slice(0, separatorIndex).trim() === name) {
        return decodeURIComponent(part.slice(separatorIndex + 1).trim());
      }
    }
    return null;
  }
}
