import { ResourceNotFoundException } from '../resource-not-found.exception';

export class ProjectTypeNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Project type not found with id: ${id}`);
  }
}

export const ProjectTypeExceptions = {
  ProjectTypeNotFoundException,
};
