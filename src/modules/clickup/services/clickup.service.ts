import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import type { ConfigType } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import clickupConfig from '../../../config/clickup.config';
import { ClickUpRoutingService } from './clickup-routing.service';
import { ClickUpTaskRequestDto } from '../dto/clickup-task-request.dto';
import { ClickUpTaskResponseDto } from '../dto/clickup-task-response.dto';
import { LeadType } from '../../../common/enums/lead-type.enum';
import { ClickUpException } from '../../../common/exceptions/clickup.exception';

interface ClickUpTaskSummary {
  id: string;
  name: string;
  custom_fields?: Array<{
    id: string;
    value: any;
  }>;
}

interface ClickUpTaskListResponse {
  tasks: ClickUpTaskSummary[];
}

@Injectable()
export class ClickUpService {
  private readonly logger = new Logger(ClickUpService.name);

  constructor(
    private readonly httpService: HttpService,
    @Inject(clickupConfig.KEY)
    private readonly config: ConfigType<typeof clickupConfig>,
    private readonly routingService: ClickUpRoutingService,
  ) {}

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': this.config.accessToken, // ClickUp expects just the token, no "Bearer" prefix
      'Content-Type': 'application/json',
    };
  }

  private buildUrl(...parts: string[]): string {
    const baseUrl = 'https://api.clickup.com/api/v2';
    return `${baseUrl}/${parts.join('/')}`;
  }

  async createTask(
    type: LeadType,
    taskRequest: ClickUpTaskRequestDto,
  ): Promise<ClickUpTaskResponseDto> {
    const route = this.routingService.route(type);
    const listId = route.listId;
    
    const url = this.buildUrl('list', listId, 'task');
    
    this.logger.log(`Creating task in ClickUp: ${taskRequest.name} for type ${type}`);
    this.logger.debug(`URL: ${url}`);
    this.logger.debug(`List ID: ${listId}`);
    if (taskRequest.custom_fields) {
      this.logger.debug(`Custom fields: ${JSON.stringify(taskRequest.custom_fields, null, 2)}`);
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post<ClickUpTaskResponseDto>(url, taskRequest, {
          headers: this.getHeaders(),
        }),
      );
      
      this.logger.log(`Task created successfully in ClickUp → id=${response.data.id}`);
      return response.data;
    } catch (error: unknown) {
      const err = this.toError(error);
      const errorWithResponse = err as Error & {
        response?: { data?: unknown; status?: number };
      };
      const errorDetails = errorWithResponse.response?.data ?? err?.message;
      const statusCode = errorWithResponse.response?.status ?? 'unknown';
      this.logger.error(
        `Error creating ClickUp task [${statusCode}]: ${JSON.stringify(errorDetails)}`,
        err?.stack,
      );
      throw new ClickUpException(
        `Failed to create ClickUp task: ${JSON.stringify(errorDetails)}`,
        err,
      );
    }
  }

  async listTasks(type: LeadType): Promise<ClickUpTaskSummary[]> {
    const route = this.routingService.route(type);
    const listId = route.listId;
    
    const url = this.buildUrl('list', listId, 'task');

    try {
      const response = await firstValueFrom(
        this.httpService.get<ClickUpTaskListResponse>(url, {
          headers: this.getHeaders(),
        })
      );
      
      return response.data.tasks || [];
    } catch (error: unknown) {
      const err = this.toError(error);
      this.logger.error(
        `Error listing ClickUp tasks: ${err?.message ?? 'Unknown error'}`,
      );
      throw new ClickUpException(
        `Failed to list ClickUp tasks: ${err?.message ?? 'Unknown error'}`,
        err,
      );
    }
  }

  async findTaskIdByLeadNumber(type: LeadType, leadNumber: string): Promise<string | null> {
    const route = this.routingService.route(type);
    const fieldId = route.fields.leadNumberId;
    
    const tasks = await this.listTasks(type);
    
    const task = tasks.find(t => 
      t.custom_fields?.some(f => 
        f.id === fieldId && String(f.value) === leadNumber
      )
    );
    
    return task?.id || null;
  }

  async deleteTaskByLeadNumber(type: LeadType, leadNumber: string): Promise<boolean> {
    const taskId = await this.findTaskIdByLeadNumber(type, leadNumber);
    
    if (!taskId) {
      this.logger.warn(`No task found in ClickUp with lead number: ${leadNumber}`);
      return false;
    }
    
    return this.deleteTask(taskId);
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const url = this.buildUrl('task', taskId);

    try {
      await firstValueFrom(
        this.httpService.delete(url, {
          headers: this.getHeaders(),
        })
      );
      
      this.logger.log(`Task deleted successfully in ClickUp → id=${taskId}`);
      return true;
    } catch (error: unknown) {
      const err = this.toError(error);
      this.logger.error(
        `Error deleting ClickUp task: ${err?.message ?? 'Unknown error'}`,
      );
      throw new ClickUpException(
        `Failed to delete ClickUp task: ${err?.message ?? 'Unknown error'}`,
        err,
      );
    }
  }

  async updateTask(taskId: string, taskRequest: ClickUpTaskRequestDto): Promise<void> {
    const url = this.buildUrl('task', taskId);

    try {
      // Update basic task fields
      await firstValueFrom(
        this.httpService.put(url, taskRequest, {
          headers: this.getHeaders(),
        })
      );

      // Update custom fields individually
      if (taskRequest.custom_fields && taskRequest.custom_fields.length > 0) {
        for (const field of taskRequest.custom_fields) {
          const fieldUrl = this.buildUrl('task', taskId, 'field', field.id);
          
          await firstValueFrom(
            this.httpService.post(fieldUrl, { value: field.value }, {
              headers: this.getHeaders(),
            })
          );
        }
      }

      this.logger.log(`Task updated successfully in ClickUp → id=${taskId}`);
    } catch (error: unknown) {
      const err = this.toError(error);
      this.logger.error(
        `Error updating ClickUp task: ${err?.message ?? 'Unknown error'}`,
      );
      throw new ClickUpException(
        `Failed to update ClickUp task: ${err?.message ?? 'Unknown error'}`,
        err,
      );
    }
  }

  private toError(error: unknown): Error | undefined {
    if (error instanceof Error) return error;
    if (error === undefined || error === null) return undefined;
    return new Error(String(error));
  }
}
