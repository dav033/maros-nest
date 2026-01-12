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

  // ClickUp
  @IsUrl()
  @IsOptional()
  CLICKUP_API_URL: string = 'https://api.clickup.com/api/v2';

  @IsString()
  CLICKUP_ACCESS_TOKEN: string;

  @IsString()
  CLICKUP_CLIENT_ID: string;

  @IsString()
  CLICKUP_CLIENT_SECRET: string;

  @IsString()
  CLICKUP_TEAM_ID: string;

  @IsString()
  CLICKUP_SPACE_ID: string;

  @IsString()
  CLICKUP_LIST_ID: string;

  @IsNumber()
  @IsOptional()
  CLICKUP_DEFAULT_PRIORITY: number = 3;

  // ClickUp Construction
  @IsString()
  CLICKUP_LIST_ID_CONSTRUCTION: string;

  @IsString()
  CLICKUP_CF_CONSTRUCTION_LEADNUMBER: string;

  @IsString()
  CLICKUP_CF_CONSTRUCTION_CONTACT_NAME: string;

  @IsString()
  CLICKUP_CF_CONSTRUCTION_CUSTOMER_NAME: string;

  @IsString()
  CLICKUP_CF_CONSTRUCTION_EMAIL: string;

  @IsString()
  CLICKUP_CF_CONSTRUCTION_PHONE: string;

  @IsString()
  CLICKUP_CF_CONSTRUCTION_NOTES: string;

  @IsString()
  CLICKUP_CF_CONSTRUCTION_LOCATION_TEXT: string;

  @IsString()
  @IsOptional()
  CLICKUP_CF_CONSTRUCTION_LOCATION: string;

  // ClickUp Plumbing
  @IsString()
  CLICKUP_LIST_ID_PLUMBING: string;

  @IsString()
  CLICKUP_CF_PLUMBING_LEADNUMBER: string;

  @IsString()
  CLICKUP_CF_PLUMBING_LOCATION_TEXT: string;

  @IsString()
  CLICKUP_CF_PLUMBING_CONTACT_NAME: string;

  @IsString()
  CLICKUP_CF_PLUMBING_CUSTOMER_NAME: string;

  @IsString()
  CLICKUP_CF_PLUMBING_EMAIL: string;

  @IsString()
  CLICKUP_CF_PLUMBING_PHONE: string;

  @IsString()
  CLICKUP_CF_PLUMBING_NOTES: string;

  // Supabase
  @IsString()
  SUPABASE_DB_WEBHOOK_SECRET: string;

  // CORS
  @IsString()
  @IsOptional()
  CORS_ORIGINS: string = 'http://localhost:3000';

  // Logging
  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
