import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';

export class ExternalServiceException extends BaseException {
  constructor(
    message: string,
    public readonly service: string,
    public readonly originalError?: Error,
  ) {
    super(message, HttpStatus.BAD_GATEWAY, 'EXTERNAL_SERVICE_ERROR');
  }
}
