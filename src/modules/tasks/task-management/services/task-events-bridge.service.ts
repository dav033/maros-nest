import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Subject } from 'rxjs';

export interface TaskChangedEvent {
  taskId: number;
  actorId: number;
}

/**
 * Bridges TasksService's `task.changed` EventEmitter2 events (see
 * TasksService.emitTaskChanged) into an RxJS stream the SSE controller subscribes to
 * per connected client — the transport behind the live board/list/mine views.
 *
 * One shared Subject, not one per request: every mutation emits once, and every
 * connected client's controller-level subscription (see TasksController.streamEvents)
 * filters it down to "not my own change" independently. `task.changed` is
 * deliberately coarse — one signal per mutated task, no per-field diff — so this
 * bridge doesn't need updating every time TasksService gains a new field to touch.
 */
@Injectable()
export class TaskEventsBridgeService {
  private readonly subject = new Subject<TaskChangedEvent>();
  readonly changes$ = this.subject.asObservable();

  @OnEvent('task.changed')
  onTaskChanged(event: TaskChangedEvent): void {
    this.subject.next(event);
  }
}
