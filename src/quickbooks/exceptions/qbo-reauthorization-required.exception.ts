import { HttpStatus } from '@nestjs/common';
import { BaseException } from '../../common/exceptions/base.exception';

export class QboReauthorizationRequiredException extends BaseException {
  constructor(realmId: string) {
    super(
      `QuickBooks connection for realm "${realmId}" requires manual reauthorization. Visit /quickbooks/connect to re-authenticate.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      'QBO_REAUTHORIZATION_REQUIRED',
    );
  }
}
