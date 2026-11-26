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
  type Scope = {
    ended: boolean;
    tx: Transaction;
    root: Scope;
    queue: Promise<unknown>;
    nested: Promise<unknown> | null;
  };
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
    while (open && scope?.root !== open) await closed;
    while (scope?.nested) await scope.nested.catch(() => undefined);
    return execute(query, params, method);
  }

  type Result = { rows: unknown[] };

  async function runInOrder(
    queries: { sql: string; params: unknown[]; method: Method }[]
  ): Promise<Result[]> {
    const results: Result[] = [];
    for (const { sql, params, method } of queries) {
      results.push(await gated(sql, params, method));
    }
    return results;
  }

  const db = drizzle(
    (query, params, method) => gated(query, params, method),
    (queries): Promise<Result[]> =>
      scopes.getStore() ? runInOrder(queries) : transaction(() => runInOrder(queries)),
    { schema }
  );

  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
  type Behavior = 'deferred' | 'immediate' | 'exclusive';
  const begin = db.transaction.bind(db);

  function joinOpen<T>(parent: Scope, callback: (tx: Transaction) => Promise<T>): Promise<T> {
    const run = parent.queue.then(() => {
      const child = {
        ended: false,
        root: parent.root,
        queue: Promise.resolve(),
        nested: null,
      } as Scope;
      const savepoint = scopes.run(child, () =>
        parent.tx.transaction((tx) => {
          child.tx = tx;
          return callback(tx);
        })
      );
      parent.nested = savepoint;
      return savepoint.finally(() => {
        child.ended = true;
        parent.nested = null;
      });
    });
    parent.queue = run.catch(() => undefined);
    return run;
  }

  async function transaction<T>(
    callback: (tx: Transaction) => Promise<T>,
    config: { behavior?: Behavior } = {}
  ): Promise<T> {
    const outer = scopes.getStore();
    if (outer?.ended) throw new TransactionEndedError();
    if (outer && outer.root === open) return joinOpen(outer, callback);
    while (open) await closed;
    let close: () => void = () => undefined;
    closed = new Promise((resolve) => {
      close = resolve;
    });
    const scope = { ended: false, queue: Promise.resolve(), nested: null } as Scope;
    scope.root = scope;
    open = scope;
    try {
      return await scopes.run(scope, () =>
        begin(
          (tx) => {
            scope.tx = tx;
            return callback(tx);
          },
          { behavior: config.behavior ?? 'immediate' }
        )
      );
    } finally {
      scope.ended = true;
      open = null;
      close();
    }
  }

  function outsideTransaction<T>(fn: () => T): T {
    return scopes.exit(fn);
  }

  Object.assign(db, { transaction });
  return {
    db: db as typeof db & { transaction: typeof transaction },
    transaction,
    outsideTransaction,
  };
}
