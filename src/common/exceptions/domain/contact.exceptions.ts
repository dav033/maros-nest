import { ResourceNotFoundException } from '../resource-not-found.exception';

export class ContactNotFoundException extends ResourceNotFoundException {
  constructor(identifier: string | number) {
    const message =
      typeof identifier === 'number'
        ? `Contact not found with id: ${identifier}`
        : `Contact not found with name: ${identifier}`;
    super(message);
  }
}

export const ContactExceptions = {
  ContactNotFoundException,
};
