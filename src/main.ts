import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedCorsOrigin(
  origin: string,
  configuredOrigins: string[],
): boolean {
  if (configuredOrigins.includes('*')) return true;
  if (configuredOrigins.includes(origin)) return true;

  return [
    /^https?:\/\/localhost(?::\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
    /^https?:\/\/\[::1\](?::\d+)?$/,
    /^https:\/\/.*\.marosconstruction\.com$/,
    /^https:\/\/.*\.netlify\.app$/,
  ].some((pattern) => pattern.test(origin));
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Get ConfigService
  const configService = app.get(ConfigService);

  // Use Winston logger
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // Global prefix for all routes
  const apiPrefix = configService.get<string>('API_PREFIX', 'api');
  app.setGlobalPrefix(apiPrefix);

  // CORS Configuration (migrated from CorsFilterConfig.java)
  const corsOrigins = parseCorsOrigins(
    configService.get<string>('CORS_ORIGINS', 'http://localhost:3000'),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      const requestOrigin = typeof origin === 'string' ? origin : undefined;
      if (!requestOrigin || isAllowedCorsOrigin(requestOrigin, corsOrigins)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Content-Type'],
    credentials: true,
    maxAge: 86400,
    optionsSuccessStatus: 204,
  });

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: true, // Throw error if non-whitelisted properties are present
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Convert types automatically
      },
    }),
  );

  // Swagger/OpenAPI Documentation
  const config = new DocumentBuilder()
    .setTitle('Maros Construction CRM API')
    .setDescription(
      'REST API for Maros Construction CRM - Migrated from Spring Boot to NestJS',
    )
    .setVersion('2.0.0')
    .addTag('companies', 'Company management endpoints')
    .addTag('contacts', 'Contact management endpoints')
    .addTag('leads', 'Lead management endpoints')
    .addTag('projects', 'Project management endpoints')
    .addTag('clickup', 'ClickUp integration endpoints')
    .addTag('crm-summary', 'CRM summary and metrics endpoints')
    .addBearerAuth() // If authentication is needed
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  // Get port from environment
  const port = configService.get<number>('PORT', 8080);

  await app.listen(port, '0.0.0.0');

  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                                                               ║
  ║   🚀 Maros Construction CRM API                              ║
  ║                                                               ║
  ║   📡 Server running on: http://localhost:${port}                ║
  ║   📚 API Documentation: http://localhost:${port}/${apiPrefix}/docs      ║
  ║   🌍 Environment: ${configService.get('NODE_ENV')}                        ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
}

void bootstrap();
