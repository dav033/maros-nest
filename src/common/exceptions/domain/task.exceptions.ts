import { HttpStatus } from '@nestjs/common';
import { ResourceNotFoundException } from '../resource-not-found.exception';
import { BusinessException } from '../business.exception';
import { BaseException } from '../base.exception';

export class TaskNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Task not found with id: ${id}`);
  }
}

/**
 * Thrown by TasksService.update when the caller's `expectedUpdatedAt` no longer
 * matches the row — someone else saved a change to this task in between the caller
 * loading it and submitting this edit. 409, not 422/BusinessException: this isn't a
 * validation problem with the payload, it's a stale read.
 */
export class TaskConflictException extends BaseException {
  constructor() {
    super('This task was changed by someone else. Reload to see the latest version.', HttpStatus.CONFLICT, 'TASK_CONFLICT');
  }
}

export class TaskLabelNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Task label not found with id: ${id}`);
  }
}

export class TaskLabelNameConflictException extends BusinessException {
  constructor(name: string) {
    super(`A label named "${name}" already exists`, 'TASK_LABEL_NAME_CONFLICT');
  }
}

/** Subtasks are one level only — see PLAN-TAREAS.md section 0.5. */
export class TaskSubtaskNestingException extends BusinessException {
  constructor(parentId: number) {
    super(
      `Task ${parentId} is itself a subtask and cannot have subtasks of its own`,
      'TASK_SUBTASK_NESTING',
    );
  }
}

/** A blocked task with no reason is noise — see db CHECK tasks_blocked_needs_reason. */
export class TaskBlockedReasonRequiredException extends BusinessException {
  constructor() {
    super('A reason is required to mark a task as blocked', 'TASK_BLOCKED_REASON_REQUIRED');
  }
}

export class TaskCommentNotFoundException extends ResourceNotFoundException {
  constructor(id: number) {
    super(`Task comment not found with id: ${id}`);
  }
}

export const TaskExceptions = {
  TaskNotFoundException,
  TaskConflictException,
  TaskLabelNotFoundException,
  TaskLabelNameConflictException,
  TaskSubtaskNestingException,
  TaskBlockedReasonRequiredException,
  TaskCommentNotFoundException,
};
