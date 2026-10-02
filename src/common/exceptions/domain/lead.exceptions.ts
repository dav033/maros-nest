import { ResourceNotFoundException } from '../resource-not-found.exception';
import { BusinessException } from '../business.exception';

export class LeadNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Lead not found with id: ${id}`);
  }
}

export class LeadNotFoundByNumberException extends ResourceNotFoundException {
  constructor(leadNumber: string) {
    super(`Lead not found with lead number: ${leadNumber}`);
  }
}

export class LeadCreationException extends BusinessException {
  constructor(message: string, public readonly originalError?: Error) {
    super(message, 'LEAD_CREATION_ERROR');
  }
}

/**
 * A lead may only enter LOST with a reason attached.
 *
 * Made a hard transition rule rather than an optional field because an optional one stays
 * empty forever: nobody reopens a closed deal to annotate why it died. That is exactly how
 * 59 lost leads — the three biggest worth $1.39M together, near the entire won value —
 * became impossible to learn anything from, which is the problem this rule exists to stop
 * recurring. Only the transition is checked; rows that were already LOST before the column
 * existed are left alone, since there is nobody left to ask.
 */
export class LeadLostReasonRequiredException extends BusinessException {
  constructor(id: number) {
    super(
      `Lead ${id} cannot be marked LOST without a lost reason`,
      'LEAD_LOST_REASON_REQUIRED',
    );
  }
}

export const LeadExceptions = {
  LeadNotFoundException,
  LeadNotFoundByNumberException,
  LeadCreationException,
  LeadLostReasonRequiredException,
};
