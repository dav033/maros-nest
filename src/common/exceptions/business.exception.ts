import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';

export class BusinessException extends BaseException {
  constructor(message: string, code?: string) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, code);
  }
}
