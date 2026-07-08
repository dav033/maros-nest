export const QBO_MAX_CONCURRENCY = 3;
export const QBO_ATTACHMENT_CONCURRENCY = 3;

/**
 * Executes an array of task factories with a bounded concurrency limit.
 *
 *  - Results are returned in the same order as the input array.
 *  - The first rejected task rejects the whole promise (fail-fast).
 *  - No new tasks are started after a rejection.
 *
 * Implemented with a native semaphore/work-pool so no extra dependencies are
 * required beyond the Node.js runtime.
 *
 * @param tasks    Lazy task factories, each returning a promise. They are
 *                 invoked on-demand, not upfront.
 * @param concurrency  Maximum number of tasks running simultaneously.
 *                     Values ≤ 0 are treated as 1; values above
 *                     `tasks.length` are capped to `tasks.length`.
 * @returns The results in the same order as the input `tasks` array.
 *
 * @example
 * const results = await runWithConcurrency(
 *   [1, 2, 3].map(n => () => fetch(`/api/${n}`)),
 *   2,
 * );
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, tasks.length));
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let completed = 0;
  let rejected = false;

  return new Promise<T[]>((resolve, reject) => {
    const worker = async (): Promise<void> => {
      const currentIndex = nextIndex++;

      try {
        results[currentIndex] = await tasks[currentIndex]();
      } catch (error) {
        if (!rejected) {
          rejected = true;
          reject(
            error instanceof Error
              ? error
              : new Error(typeof error === 'string' ? error : String(error)),
          );
        }
        return;
      }

      completed += 1;

      if (completed === tasks.length) {
        resolve(results);
        return;
      }

      if (!rejected && nextIndex < tasks.length) {
        void worker();
      }
    };

    for (let i = 0; i < limit; i++) {
      void worker();
    }
  });
}
