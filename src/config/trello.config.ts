import { registerAs } from '@nestjs/config';

export interface TrelloConfig {
  apiKey: string;
  token: string;
  apiBase: string;
}

export default registerAs(
  'trello',
  (): TrelloConfig => ({
    apiKey: process.env.TRELLO_API_KEY || '',
    token: process.env.TRELLO_SECRET_KEY || '',
    apiBase: 'https://api.trello.com/1',
  }),
);
