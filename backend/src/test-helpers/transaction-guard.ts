import { inAsyncTransaction } from '../db/async-sqlite';

const violations: string[] = [];

export class WorkInsideTransactionError extends Error {
  constructor(what: string) {
    super(`${what} ran inside an async database transaction; only database work belongs there`);
  }
}

export function refuseInsideTransaction(what: string): void {
  if (!inAsyncTransaction()) return;
  violations.push(what);
  throw new WorkInsideTransactionError(what);
}

export function takeTransactionViolations(): string[] {
  return violations.splice(0);
}

export function guardFetch(): void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = Object.assign((...args: Parameters<typeof fetch>) => {
    refuseInsideTransaction('fetch');
    return realFetch(...args);
  }, realFetch);
}
