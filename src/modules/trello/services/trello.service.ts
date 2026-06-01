import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import { ExternalServiceException } from '../../../common/exceptions';
import trelloConfig from '../../../config/trello.config';
import {
  CreateTrelloCardInput,
  TrelloBoard,
  TrelloCard,
  TrelloList,
  TrelloMember,
  UpdateTrelloCardInput,
} from '../dto/trello.dto';

@Injectable()
export class TrelloService {
  private readonly logger = new Logger(TrelloService.name);

  constructor(
    @Inject(trelloConfig.KEY)
    private readonly config: ConfigType<typeof trelloConfig>,
    private readonly httpService: HttpService,
  ) {}

  async listBoardsForMe(): Promise<TrelloBoard[]> {
    return this.get<TrelloBoard[]>('/members/me/boards', {
      fields: 'id,name,closed,url',
      filter: 'open',
    });
  }

  async listListsByBoard(boardId: string): Promise<TrelloList[]> {
    return this.get<TrelloList[]>(`/boards/${boardId}/lists`, {
      fields: 'id,name,idBoard,closed',
      filter: 'open',
    });
  }

  async listMembersByBoard(boardId: string): Promise<TrelloMember[]> {
    return this.get<TrelloMember[]>(`/boards/${boardId}/members`, {
      fields: 'id,fullName,username',
    });
  }

  async getMe(): Promise<TrelloMember> {
    return this.get<TrelloMember>('/members/me', {
      fields: 'id,fullName,username',
    });
  }

  async createCard(input: CreateTrelloCardInput): Promise<TrelloCard> {
    return this.post<TrelloCard>('/cards', {
      idList: input.idList,
      name: input.name,
      desc: input.desc,
      due: input.due,
      idMembers: input.idMembers?.join(','),
      pos: input.pos ?? 'bottom',
    });
  }

  async getCard(cardId: string): Promise<TrelloCard> {
    return this.get<TrelloCard>(`/cards/${cardId}`);
  }

  async updateCard(
    cardId: string,
    input: UpdateTrelloCardInput,
  ): Promise<TrelloCard> {
    return this.put<TrelloCard>(`/cards/${cardId}`, {
      ...input,
      idMembers: input.idMembers?.join(','),
    });
  }

  async deleteCard(cardId: string): Promise<void> {
    await this.delete(`/cards/${cardId}`);
  }

  async listCardsByList(listId: string): Promise<TrelloCard[]> {
    return this.get<TrelloCard[]>(`/lists/${listId}/cards`);
  }

  private authParams(): { key: string; token: string } {
    return { key: this.config.apiKey, token: this.config.token };
  }

  private async get<T>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return this.exec<T>(
      () =>
        this.httpService.get<T>(`${this.config.apiBase}${path}`, {
          params: { ...this.authParams(), ...params },
        }),
      `GET ${path}`,
    );
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.exec<T>(
      () =>
        this.httpService.post<T>(`${this.config.apiBase}${path}`, null, {
          params: { ...this.authParams(), ...body },
        }),
      `POST ${path}`,
    );
  }

  private async put<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.exec<T>(
      () =>
        this.httpService.put<T>(`${this.config.apiBase}${path}`, null, {
          params: { ...this.authParams(), ...body },
        }),
      `PUT ${path}`,
    );
  }

  private async delete(path: string): Promise<void> {
    await this.exec<unknown>(
      () =>
        this.httpService.delete(`${this.config.apiBase}${path}`, {
          params: this.authParams(),
        }),
      `DELETE ${path}`,
    );
  }

  private async exec<T>(
    call: () => Observable<AxiosResponse<T>>,
    label: string,
  ): Promise<T> {
    try {
      const resp = await firstValueFrom(call());
      return resp.data;
    } catch (err: any) {
      const status = err?.response?.status;
      const body = err?.response?.data;
      this.logger.error(
        `Trello ${label} failed [${status}]: ${JSON.stringify(body)}`,
      );
      throw new ExternalServiceException(
        `Trello ${label} failed: ${err?.message ?? 'unknown'}`,
        'Trello',
        err,
      );
    }
  }
}
