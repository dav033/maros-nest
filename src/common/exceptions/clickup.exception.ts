import { ExternalServiceException } from './external-service.exception';

export class ClickUpException extends ExternalServiceException {
  constructor(message: string, originalError?: Error) {
    super(message, 'ClickUp', originalError);
  }
}
