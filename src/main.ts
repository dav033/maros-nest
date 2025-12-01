import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

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
  const corsOrigins = configService
    .get<string>('CORS_ORIGINS', 'http://localhost:3000')
    .split(',');

  app.enableCors({
    origin: [
      ...corsOrigins,
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
      /^https:\/\/.*\.marosconstruction\.com$/,
      'https://maros-app.netlify.app',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: '*',
    credentials: true,
    maxAge: 3600,
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

  await app.listen(port);

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

bootstrap();
