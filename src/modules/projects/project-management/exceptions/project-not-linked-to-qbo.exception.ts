import { HttpStatus } from '@nestjs/common';
import { BaseException } from '../../../../common/exceptions/base.exception';

export class ProjectNotLinkedToQboException extends BaseException {
  constructor(projectLabel: string) {
    super(
      `El proyecto ${projectLabel} no está vinculado a un cliente de QuickBooks; vincúlalo desde la importación de QuickBooks para poder consultar sus reportes.`,
      HttpStatus.CONFLICT,
      'PROJECT_NOT_LINKED_TO_QBO',
    );
  }
}
