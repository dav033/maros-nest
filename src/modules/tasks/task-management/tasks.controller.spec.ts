import type { MessageEvent } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TaskEventsBridgeService } from './services/task-events-bridge.service';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';

function user(id: number): AuthenticatedUser {
  return {
    id,
    email: `user${id}@marosconstruction.com`,
    name: null,
    picture: null,
    role: null,
    permissions: [],
  };
}

describe('TasksController.streamEvents', () => {
  it('excludes the caller\'s own task.changed events but relays everyone else\'s', () => {
    const bridge = new TaskEventsBridgeService();
    const controller = new TasksController(
      {} as never,
      {} as never,
      {} as never,
      bridge,
    );

    const received: MessageEvent[] = [];
    const subscription = controller.streamEvents(user(1)).subscribe((event) => received.push(event));

    bridge.onTaskChanged({ taskId: 10, actorId: 1 }); // the caller's own edit
    bridge.onTaskChanged({ taskId: 11, actorId: 2 }); // someone else's edit
    subscription.unsubscribe();

    expect(received).toEqual([{ type: 'task.changed', data: { taskId: 11, actorId: 2 } }]);
  });
});
