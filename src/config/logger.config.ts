import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

export const getLoggerConfig = (
  nodeEnv: string,
  logLevel: string,
): WinstonModuleOptions => {
  const isProduction = nodeEnv === 'production';

  return {
    transports: [
      new winston.transports.Console({
        level: logLevel || 'info',
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.errors({ stack: true }),
          winston.format.splat(),
          isProduction
            ? winston.format.json() // JSON format for production (easier to parse)
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
                  let msg = `${timestamp} [${level}]`;
                  if (context) {
                    msg += ` [${context}]`;
                  }
                  msg += `: ${message}`;
                  
                  // Add metadata if present
                  const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
                  return metaStr ? `${msg} ${metaStr}` : msg;
                }),
              ),
        ),
      }),
    ],
  };
};
