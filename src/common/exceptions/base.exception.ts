import { HttpException, HttpStatus } from '@nestjs/common';

export abstract class BaseException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    public readonly code?: string,
  ) {
    super(message, status);
    this.name = this.constructor.name;
  }
}
