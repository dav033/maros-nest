import { HttpStatus } from '@nestjs/common';
import { BaseException } from '../../../../common/exceptions/base.exception';

export class ProjectNotLinkedToQboException extends BaseException {
  constructor(projectLabel: string) {
    super(
      `Project ${projectLabel} is not linked to a QuickBooks customer, and no QuickBooks job name carries its project number. Link it by hand from the project page ("Enlazar con QuickBooks") or from the QuickBooks import to be able to read its reports.`,
      HttpStatus.CONFLICT,
      'PROJECT_NOT_LINKED_TO_QBO',
    );
  }
}
