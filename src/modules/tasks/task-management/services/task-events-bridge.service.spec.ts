import { firstValueFrom, take, toArray } from 'rxjs';
import { TaskEventsBridgeService } from './task-events-bridge.service';

describe('TaskEventsBridgeService', () => {
  it('relays task.changed events to every subscriber', async () => {
    const bridge = new TaskEventsBridgeService();
    const received = firstValueFrom(bridge.changes$.pipe(take(2), toArray()));

    bridge.onTaskChanged({ taskId: 1, actorId: 5 });
    bridge.onTaskChanged({ taskId: 2, actorId: 6 });

    expect(await received).toEqual([
      { taskId: 1, actorId: 5 },
      { taskId: 2, actorId: 6 },
    ]);
  });

  it('multicasts one event to two independent subscribers', () => {
    const bridge = new TaskEventsBridgeService();
    const seenByA: unknown[] = [];
    const seenByB: unknown[] = [];
    bridge.changes$.subscribe((e) => seenByA.push(e));
    bridge.changes$.subscribe((e) => seenByB.push(e));

    bridge.onTaskChanged({ taskId: 1, actorId: 5 });

    expect(seenByA).toEqual([{ taskId: 1, actorId: 5 }]);
    expect(seenByB).toEqual([{ taskId: 1, actorId: 5 }]);
  });
});
