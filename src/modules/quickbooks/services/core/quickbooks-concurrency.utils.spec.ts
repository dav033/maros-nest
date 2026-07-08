import { QBO_ATTACHMENT_CONCURRENCY, QBO_MAX_CONCURRENCY, runWithConcurrency } from './quickbooks-concurrency.utils';

describe('runWithConcurrency', () => {
  it('returns results in input order', async () => {
    const tasks = [1, 2, 3, 4, 5].map((n) => () => Promise.resolve(n * 2));
    const result = await runWithConcurrency(tasks, QBO_MAX_CONCURRENCY);
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it('handles an empty task list', async () => {
    const result = await runWithConcurrency([], QBO_MAX_CONCURRENCY);
    expect(result).toEqual([]);
  });

  it('respects the concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      return i;
    });

    await runWithConcurrency(tasks, 3);
    expect(maxRunning).toBeLessThanOrEqual(3);
  });

  it('caps concurrency to the number of tasks', async () => {
    let running = 0;
    let maxRunning = 0;

    const tasks = [() => Promise.resolve(1), () => Promise.resolve(2)];
    const wrapped = tasks.map((task) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      const result = await task();
      running -= 1;
      return result;
    });

    await runWithConcurrency(wrapped, 10);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('rejects immediately on the first failure (fail-fast)', async () => {
    const error = new Error('boom');
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.reject(error),
      () => new Promise((resolve) => setTimeout(() => resolve(3), 50)),
    ];

    await expect(runWithConcurrency(tasks, QBO_MAX_CONCURRENCY)).rejects.toBe(error);
  });

  it('does not start remaining tasks after a rejection', async () => {
    const started: number[] = [];
    const error = new Error('boom');

    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      started.push(i);
      if (i === 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      return i;
    });

    await expect(runWithConcurrency(tasks, 2)).rejects.toBe(error);
    // With concurrency 2, tasks 0 and 1 start. Task 1 rejects before task 2
    // is scheduled, so only tasks 0 and 1 should have started.
    expect(started).toContain(0);
    expect(started).toContain(1);
    expect(started).not.toContain(2);
  });

  it('treats concurrency <= 0 as 1', async () => {
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 4 }, (_, i) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return i;
    });

    await runWithConcurrency(tasks, 0);
    expect(maxRunning).toBe(1);
  });

  it('exports expected QBO concurrency constants', () => {
    expect(QBO_MAX_CONCURRENCY).toBe(3);
    expect(QBO_ATTACHMENT_CONCURRENCY).toBe(3);
  });
});
