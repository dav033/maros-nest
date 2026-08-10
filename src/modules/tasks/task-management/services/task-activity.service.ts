import { Injectable } from '@nestjs/common';
import { TaskActivityRepository } from '../repositories/task-activity.repository';
import { TaskActivity } from '../../../../entities/task-activity.entity';

/**
 * Named call sites for TaskActivityRepository.log, so a mutation in TasksService reads
 * as "what happened" rather than assembling a {kind, fromValue, toValue} triple inline
 * at every call site.
 */
@Injectable()
export class TaskActivityService {
  constructor(private readonly taskActivityRepository: TaskActivityRepository) {}

  logCreated(taskId: number, actorId: number | null) {
    return this.taskActivityRepository.log({ taskId, actorId, kind: 'created' });
  }

  logStatusChanged(taskId: number, actorId: number | null, from: string, to: string) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'status_changed',
      fromValue: from,
      toValue: to,
    });
  }

  logBlocked(taskId: number, actorId: number | null, reason: string) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'blocked',
      toValue: reason,
    });
  }

  logUnblocked(taskId: number, actorId: number | null) {
    return this.taskActivityRepository.log({ taskId, actorId, kind: 'unblocked' });
  }

  logAssigned(taskId: number, actorId: number | null, toUserId: number) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'assigned',
      toValue: String(toUserId),
    });
  }

  logUnassigned(taskId: number, actorId: number | null, fromUserId: number | null) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'unassigned',
      fromValue: fromUserId != null ? String(fromUserId) : null,
    });
  }

  logDueChanged(taskId: number, actorId: number | null, from: string | null, to: string | null) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'due_changed',
      fromValue: from,
      toValue: to,
    });
  }

  logPriorityChanged(taskId: number, actorId: number | null, from: string, to: string) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'priority_changed',
      fromValue: from,
      toValue: to,
    });
  }

  logEntityLinked(taskId: number, actorId: number | null, entityKind: string, entityId: number) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'entity_linked',
      toValue: `${entityKind}:${entityId}`,
    });
  }

  logEntityUnlinked(taskId: number, actorId: number | null) {
    return this.taskActivityRepository.log({ taskId, actorId, kind: 'entity_unlinked' });
  }

  logSubtaskAdded(taskId: number, actorId: number | null, subtaskId: number) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'subtask_added',
      toValue: String(subtaskId),
    });
  }

  logCommented(taskId: number, actorId: number | null, commentId: number) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'commented',
      toValue: String(commentId),
    });
  }

  logAttachmentAdded(taskId: number, actorId: number | null, addedCount: number) {
    return this.taskActivityRepository.log({
      taskId,
      actorId,
      kind: 'attachment_added',
      toValue: String(addedCount),
    });
  }

  findByTask(taskId: number): Promise<TaskActivity[]> {
    return this.taskActivityRepository.findByTask(taskId);
  }
}
