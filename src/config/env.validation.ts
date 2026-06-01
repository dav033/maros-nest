import { plainToClass } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  validateSync,
  IsOptional,
  IsUrl,
  IsBoolean,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  // Database
  @IsString()
  DB_HOST: string;

  @IsNumber()
  DB_PORT: number;

  @IsString()
  DB_NAME: string;

  @IsString()
  DB_USER: string;

  @IsString()
  DB_PASS: string;

  @IsBoolean()
  @IsOptional()
  DB_SSL: boolean = false;

  // Application
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api';

  // Supabase
  @IsString()
  SUPABASE_DB_WEBHOOK_SECRET: string;

  // Trello
  @IsString()
  @IsOptional()
  TRELLO_API_KEY: string;

  @IsString()
  @IsOptional()
  TRELLO_SECRET_KEY: string;

  // CORS
  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = 'http://localhost:3000';

  // Logging
  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';

  // MCP Server
  @IsString()
  @IsOptional()
  MCP_TOKEN: string;

  // QuickBooks Online
  @IsString()
  @IsOptional()
  QB_CLIENT_ID: string;

  @IsString()
  @IsOptional()
  QB_SECRET_KEY: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  QB_REDIRECT_URI: string;

  @IsEnum(['sandbox', 'production'])
  @IsOptional()
  QB_ENVIRONMENT: 'sandbox' | 'production' = 'sandbox';

  /** 64 hex characters = 32 bytes for AES-256-GCM. Generate with: openssl rand -hex 32 */
  @IsString()
  @IsOptional()
  QB_ENCRYPTION_KEY: string;
}

export function validate(config: Record<string, unknown>) {
  const normalizedConfig = { ...config };
  for (const key of [
    'QB_CLIENT_ID',
    'QB_SECRET_KEY',
    'QB_REDIRECT_URI',
    'QB_ENCRYPTION_KEY',
  ]) {
    if (normalizedConfig[key] === '') delete normalizedConfig[key];
  }

  const validatedConfig = plainToClass(EnvironmentVariables, normalizedConfig, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  const isProduction = validatedConfig.NODE_ENV === Environment.Production;
  const missingQboConfig = [
    'QB_CLIENT_ID',
    'QB_SECRET_KEY',
    'QB_REDIRECT_URI',
    'QB_ENCRYPTION_KEY',
  ].filter((key) => !normalizedConfig[key]);

  if (isProduction && missingQboConfig.length > 0) {
    throw new Error(
      `Missing required QuickBooks configuration: ${missingQboConfig.join(', ')}`,
    );
  }

  const missingTrelloConfig = ['TRELLO_API_KEY', 'TRELLO_SECRET_KEY'].filter(
    (key) => !normalizedConfig[key],
  );

  if (isProduction && missingTrelloConfig.length > 0) {
    throw new Error(
      `Missing required Trello configuration: ${missingTrelloConfig.join(', ')}`,
    );
  }

  return validatedConfig;
}
