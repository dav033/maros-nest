import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { QuickbooksApiService } from './services/core/quickbooks-api.service';
import { QuickbooksAuthService } from './services/core/quickbooks-auth.service';
import {
  ProjectFinancials,
  QuickbooksFinancialsService,
} from './services/financials/quickbooks-financials.service';
import { QuickbooksAttachmentsService } from './services/attachments/quickbooks-attachments.service';

/** OAuth state tokens expire after this many milliseconds (10 minutes). */
const STATE_TTL_MS = 10 * 60 * 1000;

@ApiTags('QuickBooks')
@Controller('quickbooks')
export class QuickbooksController {
  private readonly logger = new Logger(QuickbooksController.name);

  /**
   * In-memory CSRF state store: state -> expiry timestamp.
   * For multi-instance deployments, replace with a shared Redis SET.
   */
  private readonly pendingStates = new Map<string, number>();

  constructor(
    private readonly authService: QuickbooksAuthService,
    private readonly apiService: QuickbooksApiService,
    private readonly financialsService: QuickbooksFinancialsService,
    private readonly attachmentsService: QuickbooksAttachmentsService,
  ) {}

  /**
   * Step 1 — send the user to Intuit's consent screen.
   * Visit this URL once in a browser to authorize the app.
   */
  @Get('connect')
  @ApiOperation({ summary: 'Initiate QuickBooks OAuth 2.0 authorization' })
  connect(@Res() res: Response): void {
    const state = randomBytes(16).toString('hex');
    this.pendingStates.set(state, Date.now() + STATE_TTL_MS);
    this.pruneExpiredStates();

    const authUrl = this.authService.getAuthorizationUrl(state);
    this.logger.log(`Redirecting to QBO authorization (state: ${state})`);
    res.redirect(authUrl);
  }

  /**
   * Step 2 — Intuit redirects here after the user grants consent.
   * Exchanges the one-time code for tokens and stores them encrypted.
   */
  @Get('callback')
  @ApiOperation({ summary: 'QuickBooks OAuth 2.0 callback handler' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('realmId') realmId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !state || !realmId) {
      throw new BadRequestException(
        'Missing required query parameters: code, state, realmId',
      );
    }

    const expiry = this.pendingStates.get(state);
    if (!expiry || Date.now() > expiry) {
      this.pendingStates.delete(state);
      throw new BadRequestException('Invalid or expired OAuth state parameter');
    }
    this.pendingStates.delete(state);

    await this.authService.exchangeCodeForTokens(code, realmId);
    this.logger.log(`QBO connection established for realm ${realmId}`);

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>QuickBooks Connected</title>
          <style>
            body { font-family: sans-serif; text-align: center; padding: 4rem; color: #1a1a1a; }
            h1 { color: #2ca01c; }
            code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>QuickBooks Connected</h1>
          <p>Realm ID: <code>${realmId}</code></p>
          <p>The server is now authorized to call the QuickBooks API autonomously.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `);
  }

  /**
   * Health check — attempts a real API call to verify the connection is alive.
   */
  @Get('status/:realmId')
  @ApiOperation({
    summary: 'Verify QuickBooks connection is active for a realm',
  })
  async status(
    @Param('realmId') realmId: string,
  ): Promise<{ realmId: string; connected: boolean; companyName?: string }> {
    const info = (await this.apiService.getCompanyInfo(realmId)) as {
      CompanyInfo?: { CompanyName?: string };
    };

    return {
      realmId,
      connected: true,
      companyName: info?.CompanyInfo?.CompanyName,
    };
  }

  /**
   * Migrated from n8n "QuickBooks Job Financials - FAST v3".
   * Accepts one or more project numbers and returns aggregated financials
   * (estimated, invoiced, paid, outstanding) per project.
   *
   * Body: { projectNumbers: string[] } or { projectNumber: string }
   */
  @Post('job-financials')
  @ApiOperation({ summary: 'Get aggregated financial summary for one or more projects' })
  async jobFinancials(
    @Body() body: { projectNumbers?: string | string[]; projectNumber?: string },
    @Query('realmId') realmId?: string,
  ): Promise<ProjectFinancials[]> {
    const raw = body.projectNumbers ?? body.projectNumber ?? [];
    const projectNumbers = Array.isArray(raw) ? raw : [raw];
    const cleaned = projectNumbers.map((p) => String(p).trim()).filter(Boolean);

    if (!cleaned.length) {
      throw new BadRequestException(
        'Provide at least one project number in projectNumbers or projectNumber',
      );
    }

    return this.financialsService.getProjectFinancials(cleaned, realmId);
  }

  /**
   * Collect QuickBooks attachments linked to a project (Customer/Job) and its
   * related transactions (Invoice, Estimate, Payment, Purchase, Bill, etc.).
   *
   * Pass `?includeTempDownloadUrl=true` to also receive a temporary download
   * URL per attachment (QuickBooks rotates these URLs frequently, so they
   * should be requested lazily and not cached for long).
   */
  @Get('projects/:projectNumber/attachments')
  @ApiOperation({
    summary: 'List QuickBooks attachments for a project, classified by entity',
  })
  @ApiQuery({ name: 'realmId', required: false })
  @ApiQuery({ name: 'includeTempDownloadUrl', required: false, type: Boolean })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async projectAttachments(
    @Param('projectNumber') projectNumber: string,
    @Query('realmId') realmId?: string,
    @Query('includeTempDownloadUrl') includeTempDownloadUrl?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const projectNumberClean = String(projectNumber ?? '').trim();
    if (!projectNumberClean) {
      throw new BadRequestException('projectNumber path parameter is required');
    }
    const includeUrls = includeTempDownloadUrl === 'true' || includeTempDownloadUrl === '1';

    return this.attachmentsService.getProjectAttachments({
      projectNumber: projectNumberClean,
      realmId,
      startDate,
      endDate,
      includeTempDownloadUrl: includeUrls,
    });
  }

  /**
   * Fetch a fresh temporary download URL for a single QuickBooks attachable.
   * Useful when a previously returned URL has expired or for "refresh link"
   * actions in the UI.
   */
  @Get('attachments/:attachmentId/download-url')
  @ApiOperation({
    summary: 'Get a temporary download URL for a single QuickBooks attachment',
  })
  @ApiQuery({ name: 'realmId', required: false })
  async attachmentDownloadUrl(
    @Param('attachmentId') attachmentId: string,
    @Query('realmId') realmId?: string,
  ) {
    const id = String(attachmentId ?? '').trim();
    if (!id) {
      throw new BadRequestException('attachmentId path parameter is required');
    }
    const effectiveRealmId =
      realmId ?? (await this.financialsService.getDefaultRealmId());

    return this.attachmentsService.getAttachmentDownloadUrl(effectiveRealmId, id);
  }

  // ---------------------------------------------------------------------------

  private pruneExpiredStates(): void {
    const now = Date.now();
    for (const [state, expiry] of this.pendingStates) {
      if (now > expiry) this.pendingStates.delete(state);
    }
  }
}
