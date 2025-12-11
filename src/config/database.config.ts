import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  const isProduction = configService.get('NODE_ENV') === 'production';

  return {
    type: 'postgres',
    host: configService.get<string>('DB_HOST'),
    port: configService.get<number>('DB_PORT'),
    username: configService.get<string>('DB_USER'),
    password: configService.get<string>('DB_PASS'),
    database: configService.get<string>('DB_NAME'),
    ssl: configService.get<boolean>('DB_SSL') ? { rejectUnauthorized: false } : false,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
    
    // Disable synchronize - use migrations instead for schema changes
    // WARNING: synchronize: true can cause data loss and schema conflicts
    // Always use migrations for schema changes, even in development
    synchronize: false,
    
    // Don't drop schema on connection
    dropSchema: false,
    
    // Logging configuration
    logging: configService.get('LOG_LEVEL') === 'debug' ? 'all' : ['error', 'warn'],
    
    // Connection retry logic
    maxQueryExecutionTime: 10000, // Log slow queries (10 seconds)
    
    // Connection pool settings (equivalent to Hikari)
    extra: {
      max: 10, // maximum-pool-size (increased from 6)
      min: 2, // minimum-idle
      idleTimeoutMillis: 600000, // idle-timeout (10 minutes)
      connectionTimeoutMillis: 30000, // connection-timeout (30 seconds)
      acquireTimeoutMillis: 60000, // acquire-timeout (60 seconds)
      // Enable keep-alive to prevent connection drops
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    },
    
    // Auto-load entities
    autoLoadEntities: true,
  };
};
