import { ResourceNotFoundException } from '../resource-not-found.exception';
import { BusinessException } from '../business.exception';

export class LeadNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Lead not found with id: ${id}`);
  }
}

export class LeadCreationException extends BusinessException {
  constructor(message: string, public readonly originalError?: Error) {
    super(message, 'LEAD_CREATION_ERROR');
  }
}

export const LeadExceptions = {
  LeadNotFoundException,
  LeadCreationException,
};
