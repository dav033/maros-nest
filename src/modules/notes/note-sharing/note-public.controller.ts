import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { NotePublicService } from './note-public.service';
import { NoteShareLinkGuard } from './guards/note-share-link.guard';
import {
  PublicRateLimitGuard,
  RateLimited,
} from './guards/public-rate-limit.guard';
import {
  SHARE_UNLOCK_TTL_SECONDS,
  SkipLinkPassword,
  shareUnlockCookieName,
} from './guards/share-link-context';
import type { RequestWithShareLink } from './guards/share-link-context';
import { UnlockNoteLinkDto } from '../note-management/dto/unlock-note-link.dto';

/**
 * The only part of this API reachable without a session.
 *
 * @Public() switches off the global SessionAuthGuard; NoteShareLinkGuard is what
 * replaces it, resolving the URL's token into a live, unexpired, unrevoked link. Marking
 * a route @Public() without that guard would leave it genuinely open — the same pairing
 * the lead-intake routes use.
 *
 * Excluded from Swagger: these are consumed by the /p/<token> reader, and listing them
 * in the public API docs invites poking at them with made-up tokens.
 */
@ApiExcludeController()
@Public()
@Controller('public/notes')
@UseGuards(PublicRateLimitGuard, NoteShareLinkGuard)
@RateLimited({ limit: 120, windowMs: 60_000 })
export class NotePublicController {
  constructor(private readonly publicService: NotePublicService) {}

  /**
   * `pageId` is only meaningful for a link that published a folder, and it is checked
   * against that folder's subtree — an id from anywhere else answers 404.
   */
  @Get(':token')
  async getPage(
    @Req() request: RequestWithShareLink,
    @Query('pageId') pageIdParam?: string,
  ) {
    const link = request.shareLink!;
    const pageId = pageIdParam ? Number(pageIdParam) : undefined;

    const page = await this.publicService.getPublicPage(
      link,
      Number.isInteger(pageId) ? pageId : undefined,
    );

    this.publicService.recordView(link, {
      ip: this.clientIp(request),
      userAgent: request.headers['user-agent'],
      referer: request.headers['referer'],
    });

    return {
      page,
      allowIndexing: link.allowIndexing,
      includeChildren: link.includeChildren,
    };
  }

  @Get(':token/tree')
  async getTree(@Req() request: RequestWithShareLink) {
    return this.publicService.getPublicTree(request.shareLink!);
  }

  /**
   * Tight limit: this is the one public route where a wrong answer is cheap to retry,
   * so it is the only thing standing between a six-character password and a script.
   */
  /**
   * Returns the unlock proof in the body as well as setting it as a cookie. The reader
   * is served from another host and cannot rely on this API's cookie, so it keeps the
   * proof itself and replays it in the x-note-share-unlock header; the cookie is what
   * makes the endpoint usable straight from a browser too.
   */
  @Post(':token/unlock')
  @SkipLinkPassword()
  @RateLimited({ limit: 5, windowMs: 60_000 })
  @HttpCode(HttpStatus.OK)
  async unlock(
    @Req() request: RequestWithShareLink,
    @Body() dto: UnlockNoteLinkDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ unlockToken: string; expiresInSeconds: number }> {
    const link = request.shareLink!;
    const token = await this.publicService.unlock(link, dto.password);

    response.cookie(shareUnlockCookieName(link.id), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SHARE_UNLOCK_TTL_SECONDS * 1000,
      path: '/',
    });

    return { unlockToken: token, expiresInSeconds: SHARE_UNLOCK_TTL_SECONDS };
  }

  /**
   * Redirects to a short-lived presigned URL, but only for keys that appear in a
   * document this link actually publishes — see NotePublicService.getImageUrl for why
   * that check is the difference between a note and the whole bucket.
   */
  @Get(':token/images/:key')
  async getImage(
    @Req() request: RequestWithShareLink,
    @Param('key') key: string,
    @Res() response: Response,
  ): Promise<void> {
    const url = await this.publicService.getImageUrl(
      request.shareLink!,
      decodeURIComponent(key),
    );
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.redirect(url);
  }

  /** Same first-hop rule as PublicRateLimitGuard: behind a proxy, req.ip is the proxy. */
  private clientIp(request: RequestWithShareLink): string | undefined {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return request.ip;
  }
}
