import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { QuickbooksAuthService } from './quickbooks-auth.service';
import { QBO_MAX_CONCURRENCY, runWithConcurrency } from './quickbooks-concurrency.utils';

const DEFAULT_QUERY_ALL_MAX_PAGES = 50;
const ABSOLUTE_MAX_PAGES = 1000;

export interface QueryAllOptions {
  where?: string;
  orderBy?: string;
  /**
   * Optional comma-separated list of fields to fetch (e.g. `Id, DocNumber, TxnDate`).
   * When omitted, all fields are fetched (`SELECT *`). Trimming field projections
   * dramatically reduces the payload from QBO and speeds up pagination.
   */
  select?: string;
  /**
   * Optional caller-defined cache bucket to differentiate queries that would
   * otherwise share the same (entity, where, orderBy, select) key. Most callers
   * can omit it.
   */
  cacheKey?: string;
  /**
   * Optional cap on the number of pages fetched. Each page requests up to 1000
   * records, so `maxPages: 5` returns at most 5000 records. Useful when only a
   * bounded window of data is needed.
   */
  maxPages?: number;
}

@Injectable()
export class QuickbooksApiService {
  private readonly logger = new Logger(QuickbooksApiService.name);
  private readonly environment: string;
  private readonly readCacheTtlMs = 90_000;
  private readonly readCacheMaxEntries = 1_500;
  private readonly queryAllCacheTtlMs = 60_000;
  private readonly readCache = new Map<
    string,
    {
      expiresAt: number;
      value: unknown;
    }
  >();
  private readonly inFlightReadRequests = new Map<string, Promise<unknown>>();

  constructor(
    private readonly authService: QuickbooksAuthService,
    private readonly configService: ConfigService,
  ) {
    this.environment = this.configService.get<string>(
      'QB_ENVIRONMENT',
      'sandbox',
    );
  }

  // ---------------------------------------------------------------------------
  // Public API methods (existing — kept for backwards compatibility)
  // ---------------------------------------------------------------------------

  /** Runs a QBO SQL-like query via GET (SELECT statements only). */
  async query(realmId: string, sqlLikeQuery: string): Promise<unknown> {
    return this.queryRawGet(realmId, sqlLikeQuery);
  }

  /** Fetches a single Customer by ID. */
  async getCustomer(realmId: string, customerId: string): Promise<unknown> {
    return this.getOrSetReadCache(
      this.buildReadCacheKey('customer', realmId, customerId),
      () =>
        this.withRetry(realmId, (client) =>
          client.get<unknown>(`/customer/${customerId}`).then((r) => r.data),
        ),
    );
  }

  /** Creates an Invoice. invoiceData must follow the QBO Invoice object schema. */
  async createInvoice(
    realmId: string,
    invoiceData: Record<string, unknown>,
  ): Promise<unknown> {
    return this.withRetry(realmId, (client) =>
      client.post<unknown>('/invoice', invoiceData).then((r) => r.data),
    );
  }

  /** Retrieves CompanyInfo — used for health checks. */
  async getCompanyInfo(realmId: string): Promise<unknown> {
    return this.withRetry(realmId, (client) =>
      client.get<unknown>(`/companyinfo/${realmId}`).then((r) => r.data),
    );
  }

  /**
   * Fetches a single QBO entity by type and numeric/string ID.
   * entityType is case-insensitive (e.g. 'invoice', 'estimate', 'payment').
   */
  async getById(
    realmId: string,
    entityType: string,
    id: string,
  ): Promise<unknown> {
    return this.getOrSetReadCache(
      this.buildReadCacheKey('entity', realmId, entityType.toLowerCase(), id),
      () =>
        this.withRetry(realmId, (client) =>
          client
            .get<unknown>(`/${entityType.toLowerCase()}/${id}`)
            .then((r) => r.data),
        ),
    );
  }

  /**
   * Calls a QBO Reports API endpoint (e.g. ProfitAndLoss, BalanceSheet).
   * params are passed as query string parameters.
   */
  async report(
    realmId: string,
    reportName: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<unknown> {
    return this.getOrSetReadCache(
      this.buildReadCacheKey('report', realmId, reportName, JSON.stringify(params)),
      () =>
        this.withRetry(realmId, (client) =>
          client
            .get<unknown>(`/reports/${reportName}`, { params })
            .then((r) => r.data),
        ),
    );
  }

  /** Runs a raw QBO query via POST. Alias kept for backwards compatibility. */
  async queryPost(realmId: string, sqlLikeQuery: string): Promise<unknown> {
    return this.queryRawPost(realmId, sqlLikeQuery);
  }

  // ---------------------------------------------------------------------------
  // Safe query helpers
  // ---------------------------------------------------------------------------

  /** Runs a QBO SQL-like query via GET. Prefer for short queries. */
  async queryRawGet(realmId: string, sqlLikeQuery: string): Promise<unknown> {
    return this.getOrSetReadCache(
      this.buildReadCacheKey('query:get', realmId, sqlLikeQuery),
      async () => {
        try {
          return await this.withRetry(realmId, (client) =>
            client
              .get<unknown>('/query', { params: { query: sqlLikeQuery } })
              .then((r) => r.data),
          );
        } catch (error) {
          this.logQboQueryError(error, sqlLikeQuery);
          throw error;
        }
      },
    );
  }

  /**
   * Runs a QBO query via POST with content-type application/text as required
   * by the QBO API spec. Use for queries too long to fit in a GET URL.
   */
  async queryRawPost(realmId: string, sqlLikeQuery: string): Promise<unknown> {
    return this.getOrSetReadCache(
      this.buildReadCacheKey('query:post', realmId, sqlLikeQuery),
      async () => {
        try {
          return await this.withRetry(realmId, (client) =>
            client
              .post<unknown>('/query', sqlLikeQuery, {
                headers: { 'Content-Type': 'application/text' },
              })
              .then((r) => r.data),
          );
        } catch (error) {
          this.logQboQueryError(error, sqlLikeQuery);
          throw error;
        }
      },
    );
  }

  /**
   * Fetches ALL records of a QBO entity with automatic pagination.
   * Iterates STARTPOSITION in steps of 1000 until a partial page is returned.
   * Pass `options.select` to project only the fields you need (massive payload
   * reduction for large entities). Results are cached in-memory for
   * `queryAllCacheTtlMs` so repeated calls from different services share work.
   */
  async queryAll(
    realmId: string,
    entityName: string,
    options: QueryAllOptions = {},
  ): Promise<unknown[]> {
    const selectClause = options.select
      ? `SELECT ${options.select} FROM ${entityName}`
      : `SELECT * FROM ${entityName}`;
    const where = options.where ? ` WHERE ${options.where}` : '';
    const orderBy = options.orderBy ? ` ORDERBY ${options.orderBy}` : '';
    const cacheKey = this.buildReadCacheKey(
      'queryAll',
      realmId,
      options.cacheKey ?? '',
      entityName,
      options.select ?? '*',
      options.where ?? '',
      options.orderBy ?? '',
      String(options.maxPages ?? DEFAULT_QUERY_ALL_MAX_PAGES),
    );

    return this.getOrSetReadCacheWithTtl(
      cacheKey,
      () =>
        this.fetchAllPages(
          realmId,
          entityName,
          selectClause,
          where,
          orderBy,
          options.maxPages,
        ),
      this.queryAllCacheTtlMs,
    );
  }

  private async fetchAllPages(
    realmId: string,
    entityName: string,
    selectClause: string,
    where: string,
    orderBy: string,
    maxPages?: number,
  ): Promise<unknown[]> {
    const pageSize = 1000;
    const allResults: unknown[] = [];

    const firstPage = await this.fetchQueryPage(
      realmId,
      entityName,
      selectClause,
      where,
      orderBy,
      1,
      pageSize,
    );
    allResults.push(...firstPage);

    if (firstPage.length < pageSize || maxPages === 1) {
      return allResults;
    }

    const maxPagesEffective = Math.min(
      maxPages ?? DEFAULT_QUERY_ALL_MAX_PAGES,
      ABSOLUTE_MAX_PAGES,
    );

    let nextPage = 2;
    while (nextPage <= maxPagesEffective) {
      const batchSize = Math.min(
        QBO_MAX_CONCURRENCY,
        maxPagesEffective - nextPage + 1,
      );
      const positions = Array.from(
        { length: batchSize },
        (_, i) => 1 + pageSize * (nextPage + i - 1),
      );

      const batch = await runWithConcurrency(
        positions.map(
          (startPosition) => () =>
            this.fetchQueryPage(
              realmId,
              entityName,
              selectClause,
              where,
              orderBy,
              startPosition,
              pageSize,
            ),
        ),
        QBO_MAX_CONCURRENCY,
      );

      for (const page of batch) {
        allResults.push(...page);
        if (page.length < pageSize) {
          return allResults;
        }
      }

      nextPage += batchSize;
    }

    return allResults;
  }

  private async fetchQueryPage(
    realmId: string,
    entityName: string,
    selectClause: string,
    where: string,
    orderBy: string,
    startPosition: number,
    pageSize: number,
  ): Promise<unknown[]> {
    const q = `${selectClause}${where}${orderBy} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
    const resp = await this.queryRawGet(realmId, q);
    return this.getQueryResponseArray(resp, entityName);
  }

  /**
   * Returns the total record count for an entity (with optional WHERE clause).
   * Uses SELECT COUNT(*) which QBO supports natively.
   */
  async count(
    realmId: string,
    entityName: string,
    where?: string,
  ): Promise<number> {
    const whereClause = where ? ` WHERE ${where}` : '';
    const q = `SELECT COUNT(*) FROM ${entityName}${whereClause}`;
    const resp = (await this.queryRawGet(realmId, q)) as {
      QueryResponse?: { totalCount?: number };
    };
    return resp?.QueryResponse?.totalCount ?? 0;
  }

  /**
   * Extracts the entity array from a raw QBO QueryResponse object.
   * QBO wraps result arrays under QueryResponse.<PascalCaseEntityName>.
   */
  getQueryResponseArray(response: unknown, entityName: string): unknown[] {
    const qr = (response as Record<string, unknown>)?.['QueryResponse'] as
      | Record<string, unknown>
      | undefined;
    if (!qr) return [];
    const key = entityName.charAt(0).toUpperCase() + entityName.slice(1);
    const arr = qr[key];
    return Array.isArray(arr) ? arr : [];
  }

  /** Escapes a string value for safe use inside a QBO WHERE clause literal. */
  escapeQboString(value: string): string {
    return value.replace(/'/g, "''");
  }

  /**
   * Escapes a string value for safe use inside a QBO LIKE pattern.
   *
   * Escapes backslashes, single quotes, percent signs (`%`) and underscores
   * (`_`) so the literal characters are matched, preventing accidental
   * wildcard expansion in QBO's `LIKE` operator.
   *
   * @param value  Raw string to escape.
   * @returns The escaped string, safe to embed in a QBO `LIKE` clause
   *          with `ESCAPE '\'`.
   *
   * @example
   * escapeQboLike("it's 100% done_")
   * // → "it''s 100\\% done\\_"
   */
  escapeQboLike(value: string): string {
    return this.escapeQboString(value)
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
  }

  /** Extracts a named entity object from a raw QBO API response envelope. */
  unwrapQboEntity(response: unknown, entityName: string): Record<string, unknown> {
    const payload = response as Record<string, unknown>;
    const entity = payload?.[entityName];
    return entity !== null && typeof entity === 'object' && !Array.isArray(entity)
      ? (entity as Record<string, unknown>)
      : {};
  }

  /** Builds a `{ where }` option for `queryAll` from optional date range params. */
  buildDateWhereClause(params: { startDate?: string; endDate?: string }): { where?: string } {
    const filters: string[] = [];
    if (params.startDate)
      filters.push(`TxnDate >= '${this.escapeQboString(params.startDate)}'`);
    if (params.endDate)
      filters.push(`TxnDate <= '${this.escapeQboString(params.endDate)}'`);
    return filters.length ? { where: filters.join(' AND ') } : {};
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private getBaseUrl(realmId: string): string {
    const host =
      this.environment === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com';
    return `${host}/v3/company/${realmId}`;
  }

  private async buildClient(realmId: string): Promise<AxiosInstance> {
    const token = await this.authService.getValidAccessToken(realmId);
    return axios.create({
      baseURL: this.getBaseUrl(realmId),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Logs the exact query and QBO response when a query returns 400 Bad Request.
   * Does not log tokens; the query string and error body are safe to capture.
   */
  private logQboQueryError(error: unknown, query: string): void {
    if (!axios.isAxiosError(error)) {
      return;
    }
    const axiosErr = error as AxiosError<unknown>;
    const status = axiosErr.response?.status;
    if (status === 400) {
      const qboMessage = this.extractQboErrorMessage(axiosErr);
      this.logger.error(`QBO query failed with 400: ${query} — ${qboMessage}`);
    }
  }

  private extractQboErrorMessage(error: AxiosError<unknown>): string {
    const data = error.response?.data as
      | { Fault?: { Error?: Array<{ Message?: string }> } }
      | undefined;
    const messages = data?.Fault?.Error?.map((e) => e.Message).filter(Boolean);
    return messages?.join('; ') ?? JSON.stringify(error.response?.data);
  }

  /**
   * Executes the request; on a 401 refreshes tokens and retries exactly once.
   * Intuit returns 401 when the access_token has been revoked server-side even
   * if our local expiry timestamp hasn't passed yet.
   */
  private async withRetry<T>(
    realmId: string,
    request: (client: AxiosInstance) => Promise<T>,
  ): Promise<T> {
    let client = await this.buildClient(realmId);
    let tokenRefreshAttempted = false;
    const maxRateLimitRetries = 3;
    let rateLimitRetries = 0;

    while (true) {
      try {
        return await request(client);
      } catch (error) {
        const axiosErr = error as AxiosError;
        const status = axiosErr.response?.status;

        if (status === 401 && !tokenRefreshAttempted) {
          tokenRefreshAttempted = true;
          this.logger.warn(
            `QBO 401 for realm ${realmId} — refreshing token and retrying`,
          );
          await this.authService.refreshTokens(realmId);
          client = await this.buildClient(realmId);
          continue;
        }

        if (status === 429 && rateLimitRetries < maxRateLimitRetries) {
          const waitMs = this.resolveRateLimitDelayMs(axiosErr, rateLimitRetries);
          rateLimitRetries += 1;
          this.logger.warn(
            `QBO 429 for realm ${realmId} — retry ${rateLimitRetries}/${maxRateLimitRetries} in ${waitMs}ms`,
          );
          await this.sleep(waitMs);
          continue;
        }

        throw error;
      }
    }
  }

  private resolveRateLimitDelayMs(error: AxiosError, attempt: number): number {
    const retryAfterRaw = error.response?.headers?.['retry-after'];
    const retryAfterHeader = Array.isArray(retryAfterRaw)
      ? retryAfterRaw[0]
      : retryAfterRaw;
    const retryAfterSeconds = Number(retryAfterHeader);

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Math.min(30_000, Math.ceil(retryAfterSeconds * 1_000));
    }

    const baseDelayMs = 600;
    const backoffDelayMs = baseDelayMs * 2 ** attempt;
    const jitterMs = Math.floor(Math.random() * 300);
    return Math.min(10_000, backoffDelayMs + jitterMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  clearReadCache(): void {
    this.readCache.clear();
    this.inFlightReadRequests.clear();
  }

  private buildReadCacheKey(...parts: Array<string>): string {
    return parts.join('::');
  }

  private async getOrSetReadCache<T>(
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    return this.getOrSetReadCacheWithTtl(key, load, this.readCacheTtlMs);
  }

  private async getOrSetReadCacheWithTtl<T>(
    key: string,
    load: () => Promise<T>,
    ttlMs: number,
  ): Promise<T> {
    this.pruneReadCacheIfNeeded();

    const now = Date.now();
    const cached = this.readCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const inFlight = this.inFlightReadRequests.get(key);
    if (inFlight) {
      return (await inFlight) as T;
    }

    const requestPromise = load()
      .then((value) => {
        this.readCache.set(key, {
          value,
          expiresAt: Date.now() + ttlMs,
        });
        return value;
      })
      .finally(() => {
        this.inFlightReadRequests.delete(key);
      });

    this.inFlightReadRequests.set(key, requestPromise as Promise<unknown>);
    return requestPromise;
  }

  private pruneReadCacheIfNeeded(): void {
    const now = Date.now();

    for (const [key, value] of this.readCache.entries()) {
      if (value.expiresAt <= now) {
        this.readCache.delete(key);
      }
    }

    if (this.readCache.size <= this.readCacheMaxEntries) {
      return;
    }

    const excess = this.readCache.size - this.readCacheMaxEntries;
    let removed = 0;

    for (const key of this.readCache.keys()) {
      this.readCache.delete(key);
      removed += 1;
      if (removed >= excess) {
        break;
      }
    }
  }
}
