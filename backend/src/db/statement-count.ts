import { AsyncLocalStorage } from 'node:async_hooks';

const counters = new AsyncLocalStorage<{ count: number }>();

export function noteStatement(): void {
  const counter = counters.getStore();
  if (counter) counter.count++;
}

export async function countStatements<T>(
  run: () => Promise<T>
): Promise<{ result: T; statements: number }> {
  const counter = { count: 0 };
  const result = await counters.run(counter, run);
  return { result, statements: counter.count };
}
