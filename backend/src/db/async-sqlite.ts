import type { Database } from 'bun:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';

export function openAsyncDatabase(sqlite: Database) {
  const holder = new AsyncLocalStorage<symbol>();
  let open: symbol | null = null;
  let closed: Promise<void> = Promise.resolve();

  async function waitForOpenTransaction(): Promise<void> {
    while (open && holder.getStore() !== open) await closed;
  }

  const db = drizzle(
    async (query, params, method) => {
      await waitForOpenTransaction();
      const statement = sqlite.query(query);
      if (method === 'run') {
        statement.run(...(params as never[]));
        return { rows: [] };
      }
      const rows = statement.values(...(params as never[]));
      return { rows: method === 'get' ? rows[0] : rows };
    },
    { schema }
  );

  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

  async function transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    while (open) await closed;
    const mine = Symbol('transaction');
    let close = () => undefined as void;
    open = mine;
    closed = new Promise((resolve) => {
      close = resolve;
    });
    try {
      return await holder.run(mine, () => db.transaction(callback, { behavior: 'immediate' }));
    } finally {
      open = null;
      close();
    }
  }

  return { db, transaction };
}
