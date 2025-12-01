import { HttpStatus } from '@nestjs/common';
import { BaseException } from './base.exception';

export class ValidationException extends BaseException {
  constructor(message: string, public readonly field?: string) {
    super(message, HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR');
  }

  static format(template: string, ...args: any[]): ValidationException {
    const message = template.replace(/%s/g, () => String(args.shift() ?? ''));
    return new ValidationException(message);
  }
}
