import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  return {
    type: 'postgres',
    host: configService.get<string>('DB_HOST'),
    port: configService.get<number>('DB_PORT'),
    username: configService.get<string>('DB_USER'),
    password: configService.get<string>('DB_PASS'),
    database: configService.get<string>('DB_NAME'),
    ssl: configService.get<boolean>('DB_SSL') ? { rejectUnauthorized: false } : false,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    // migrations: [__dirname + '/../database/migrations/*{.ts,.js}'], // Migraciones desactivadas
    
    // Synchronize desactivado - las tablas se gestionan manualmente en Supabase
    // WARNING: synchronize: true can cause data loss in production
    synchronize: false,
    
    // Don't drop schema on connection (safety measure)
    dropSchema: false,
    
    // Logging configuration
    logging: configService.get('LOG_LEVEL') === 'debug' ? 'all' : ['error', 'warn'],
    
    // Connection retry logic
    maxQueryExecutionTime: 10000, // Log slow queries (10 seconds)
    
    // Connection pool settings. Supabase pooler (Supavisor) caps session-mode
    // clients at pool_size (15), so the app connects via transaction mode
    // (port 6543) and releases idle connections quickly.
    extra: {
      max: 10, // maximum-pool-size
      min: 0, // minimum-idle: don't hold pooler slots while idle
      idleTimeoutMillis: 30000, // idle-timeout (30 seconds)
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
