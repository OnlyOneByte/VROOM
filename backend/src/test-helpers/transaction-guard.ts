import { type Mock, mock } from 'bun:test';
import { inAsyncTransaction, reportLateQueries } from '../db/async-sqlite';

type Callable = (...args: unknown[]) => unknown;

const violations: string[] = [];

export class NetworkInsideTransactionError extends Error {
  constructor(what: string) {
    super(`${what} ran inside an async database transaction; keep network calls outside it`);
  }
}

export function refuseInsideTransaction(what: string): void {
  if (!inAsyncTransaction()) return;
  violations.push(what);
  throw new NetworkInsideTransactionError(what);
}

export const LATE_QUERY = 'A query after its transaction ended';

export function recordLateQueries(): void {
  reportLateQueries(() => violations.push(LATE_QUERY));
}

export function takeTransactionViolations(): string[] {
  return violations.splice(0);
}

export function guardProperty(target: object, key: string, what: string): void {
  const holder = target as Record<string, unknown>;
  let current = holder[key];
  const wrappers = new WeakMap<Callable, Callable>();
  const originals = new WeakMap<Callable, Callable>();
  const wrap = (value: unknown) => {
    if (typeof value !== 'function') return value;
    const fn = value as Callable;
    let wrapper = wrappers.get(fn);
    if (!wrapper) {
      wrapper = Object.assign(function (this: unknown, ...args: unknown[]) {
        try {
          refuseInsideTransaction(what);
        } catch (error) {
          return Promise.reject(error);
        }
        return fn.apply(this, args);
      }, fn);
      wrappers.set(fn, wrapper);
      originals.set(wrapper, fn);
    }
    return wrapper;
  };
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => wrap(current),
    set: (value: unknown) => {
      current = (typeof value === 'function' && originals.get(value as Callable)) || value;
    },
  });
}

type Fn = (...args: never[]) => unknown;

export function spyOnGuarded<T extends object, K extends keyof T>(
  target: T,
  key: K
): Mock<Extract<T[K], Fn>> {
  const original = target[key];
  const spy = mock(original as Extract<T[K], Fn>);
  const reset = spy.mockRestore.bind(spy);
  target[key] = spy as T[K];
  Object.defineProperty(spy, 'mockRestore', {
    configurable: true,
    value: () => {
      reset();
      target[key] = original;
    },
  });
  return spy;
}
