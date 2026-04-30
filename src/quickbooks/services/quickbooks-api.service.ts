import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { QuickbooksAuthService } from './quickbooks-auth.service';

@Injectable()
export class QuickbooksApiService {
  private readonly logger = new Logger(QuickbooksApiService.name);
  private readonly environment: string;

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
  // Public API methods
  // ---------------------------------------------------------------------------

  /** Runs a QBO SQL-like query (SELECT statements only). */
  async query(realmId: string, sqlLikeQuery: string): Promise<unknown> {
    return this.withRetry(realmId, (client) =>
      client
        .get<unknown>('/query', { params: { query: sqlLikeQuery } })
        .then((r) => r.data),
    );
  }

  /** Fetches a single Customer by ID. */
  async getCustomer(realmId: string, customerId: string): Promise<unknown> {
    return this.withRetry(realmId, (client) =>
      client.get<unknown>(`/customer/${customerId}`).then((r) => r.data),
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
    return this.withRetry(realmId, (client) =>
      client
        .get<unknown>(`/${entityType.toLowerCase()}/${id}`)
        .then((r) => r.data),
    );
  }

  /**
   * Runs a raw QBO query via POST (required when the query string is too long
   * for a GET query param, e.g. large IN lists).
   */
  async queryPost(realmId: string, sqlLikeQuery: string): Promise<unknown> {
    return this.withRetry(realmId, (client) =>
      client
        .post<unknown>('/query', sqlLikeQuery, {
          headers: { 'Content-Type': 'text/plain' },
        })
        .then((r) => r.data),
    );
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
   * Executes the request; on a 401 refreshes tokens and retries exactly once.
   * Intuit returns 401 when the access_token has been revoked server-side even
   * if our local expiry timestamp hasn't passed yet.
   */
  private async withRetry<T>(
    realmId: string,
    request: (client: AxiosInstance) => Promise<T>,
  ): Promise<T> {
    let client = await this.buildClient(realmId);

    try {
      return await request(client);
    } catch (error) {
      const axiosErr = error as AxiosError;
      if (axiosErr.response?.status === 401) {
        this.logger.warn(
          `QBO 401 for realm ${realmId} — refreshing token and retrying`,
        );
        await this.authService.refreshTokens(realmId);
        client = await this.buildClient(realmId);
        return await request(client);
      }
      throw error;
    }
  }
}
