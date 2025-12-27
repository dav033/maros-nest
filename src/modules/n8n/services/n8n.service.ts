import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import type { ConfigType } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import n8nConfig from '../../../config/n8n.config';
import { N8nProjectFinancialRequestDto } from '../dto/n8n-project-financial-request.dto';
import { N8nProjectFinancialResponseDto } from '../dto/n8n-project-financial-response.dto';

@Injectable()
export class N8nService {
  private readonly logger = new Logger(N8nService.name);
  private readonly webhookUrl: string;

  constructor(
    private readonly httpService: HttpService,
    @Inject(n8nConfig.KEY)
    private readonly config: ConfigType<typeof n8nConfig>,
  ) {
    // Construct the full webhook URL
    // Base URL is: https://n8n.marosconstruction.com/webhook/
    // Full URL should be: https://n8n.marosconstruction.com/webhook/qb-job-financials-fast-v3
    const baseUrl = this.config.webhookUrl.replace(/\/$/, ''); // Remove trailing slash
    this.webhookUrl = `${baseUrl}/qb-job-financials-fast-v3`;
  }

  /**
   * Get financial information for multiple projects from n8n webhook
   * @param projectNumbers Array of project numbers to query
   * @returns Array of financial information for each project
   */
  async getProjectFinancials(
    projectNumbers: string[],
  ): Promise<N8nProjectFinancialResponseDto[]> {
    if (!projectNumbers || projectNumbers.length === 0) {
      this.logger.warn('No project numbers provided, returning empty array');
      return [];
    }

    this.logger.log(
      `Fetching financial data from n8n for ${projectNumbers.length} projects`,
    );
    this.logger.debug(`Webhook URL: ${this.webhookUrl}`);
    this.logger.debug(`Project numbers: ${JSON.stringify(projectNumbers)}`);

    try {
      // Build query parameters - send project numbers as comma-separated or multiple params
      // Using projectNumbers as query parameter (n8n should accept this format)
      const params = new URLSearchParams();
      projectNumbers.forEach((number) => {
        params.append('projectNumbers', number);
      });

      const urlWithParams = `${this.webhookUrl}?${params.toString()}`;
      this.logger.debug(`Full URL with params: ${urlWithParams}`);

      // Measure execution time for the webhook call
      const startTime = Date.now();
      const response = await firstValueFrom(
        this.httpService.get<N8nProjectFinancialResponseDto[]>(urlWithParams, {
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      console.log(
        `[N8N WEBHOOK] Execution time: ${executionTime}ms for ${projectNumbers.length} projects`,
      );

      this.logger.log(
        `Successfully fetched financial data for ${response.data.length} projects`,
      );
      return response.data;
    } catch (error: unknown) {
      const err = error as any;
      const errorDetails = err.response?.data || err.message;
      const statusCode = err.response?.status || 'unknown';
      this.logger.error(
        `Error fetching financial data from n8n [${statusCode}]: ${JSON.stringify(errorDetails)}`,
        err.stack,
      );
      // Return empty array instead of throwing to prevent breaking the main flow
      // The frontend can handle missing financial data
      return [];
    }
  }

  /**
   * Get financial information for a single project
   * @param projectNumber Project number to query
   * @returns Financial information for the project or null if not found
   */
  async getProjectFinancial(
    projectNumber: string,
  ): Promise<N8nProjectFinancialResponseDto | null> {
    const results = await this.getProjectFinancials([projectNumber]);
    return results.length > 0 ? results[0] : null;
  }
}

