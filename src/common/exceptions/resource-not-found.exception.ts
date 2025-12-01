import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';

export class ResourceNotFoundException extends BaseException {
  constructor(message: string) {
    super(message, HttpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND');
  }
}
