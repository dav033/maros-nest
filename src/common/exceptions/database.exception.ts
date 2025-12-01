import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';

export class DatabaseException extends BaseException {
  constructor(message: string, public readonly originalError?: Error) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR, 'DATABASE_ERROR');
  }
}
