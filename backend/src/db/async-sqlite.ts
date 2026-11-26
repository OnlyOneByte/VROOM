import type { Database, Statement } from 'bun:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';

const STATEMENT_CACHE_SIZE = 500;

type Method = 'run' | 'all' | 'values' | 'get';

export class TransactionEndedError extends Error {
  constructor() {
    super('A query ran after its transaction had ended; await every query inside the callback');
  }
}

export function openAsyncDatabase(sqlite: Database) {
  type Scope = { ended: boolean; tx: Transaction };
  const scopes = new AsyncLocalStorage<Scope>();
  let open: Scope | null = null;
  let closed: Promise<void> = Promise.resolve();
  const statements = new Map<string, Statement>();

  function prepare(query: string): Statement {
    let statement = statements.get(query);
    if (statement) {
      statements.delete(query);
    } else {
      statement = sqlite.prepare(query);
      if (statements.size >= STATEMENT_CACHE_SIZE) {
        const oldest = statements.keys().next().value as string;
        statements.get(oldest)?.finalize();
        statements.delete(oldest);
      }
    }
    statements.set(query, statement);
    return statement;
  }

  function execute(query: string, params: unknown[], method: Method) {
    const statement = prepare(query);
    if (method === 'run') return { rows: [], ...statement.run(...(params as never[])) };
    const rows = statement.values(...(params as never[]));
    return { rows: method === 'get' ? rows[0] : rows };
  }

  async function gated(query: string, params: unknown[], method: Method) {
    const scope = scopes.getStore();
    if (scope?.ended) throw new TransactionEndedError();
    while (open && scope !== open) await closed;
    return execute(query, params, method);
  }

  const db = drizzle(
    (query, params, method) => gated(query, params, method),
    async (queries) => {
      const results = [];
      for (const { sql, params, method } of queries) {
        results.push(await gated(sql, params, method));
      }
      return results;
    },
    { schema }
  );

  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
  const begin = db.transaction.bind(db);

  async function transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    const outer = scopes.getStore();
    if (outer?.ended) throw new TransactionEndedError();
    if (outer && outer === open) return outer.tx.transaction(callback);
    while (open) await closed;
    let close = () => undefined as void;
    closed = new Promise((resolve) => {
      close = resolve;
    });
    const scope = { ended: false } as Scope;
    open = scope;
    try {
      return await scopes.run(scope, () =>
        begin(
          (tx) => {
            scope.tx = tx;
            return callback(tx);
          },
          { behavior: 'immediate' }
        )
      );
    } finally {
      scope.ended = true;
      open = null;
      close();
    }
  }

  Object.assign(db, { transaction });
  return { db: db as typeof db & { transaction: typeof transaction }, transaction };
}
