import type { Database, Statement } from 'bun:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';

const STATEMENT_CACHE_SIZE = 500;
const TRANSACTION_CONTROL = /^\s*(commit|rollback|release savepoint)\b/i;
const OPENING = /^\s*(begin|savepoint)\b/i;
const BEGIN = /^\s*begin\b/i;
const ROLLBACK = /^\s*rollback\b/i;
const GUARDED_METHODS = ['prepare', 'query', 'run', 'exec', 'transaction'] as const;

type Method = 'run' | 'all' | 'values' | 'get';

export class TransactionEndedError extends Error {
  constructor() {
    super('A query ran after its transaction had ended; await every query inside the callback');
  }
}

export class TransactionRolledBackError extends Error {
  constructor() {
    super('SQLite rolled this transaction back after an earlier error, so the rest was refused');
  }
}

export class RawTransactionControlError extends Error {
  constructor() {
    super('Raw BEGIN, COMMIT, ROLLBACK or SAVEPOINT inside a transaction; use transaction()');
  }
}

export class SyncQueryInAsyncTransactionError extends Error {
  constructor() {
    super(
      'A synchronous query ran on this connection while an async transaction was open; move it to the async database'
    );
  }
}

const opened = new WeakMap<Database, ReturnType<typeof createAsyncDatabase>>();

export function openAsyncDatabase(sqlite: Database) {
  let handle = opened.get(sqlite);
  if (!handle) {
    handle = createAsyncDatabase(sqlite);
    opened.set(sqlite, handle);
  }
  return handle;
}

export type AsyncAppDatabase = ReturnType<typeof openAsyncDatabase>['db'];

function createAsyncDatabase(sqlite: Database) {
  type Scope = {
    ended: boolean;
    sealed: boolean;
    begun: boolean;
    tx: Transaction;
    root: Scope;
    queue: Promise<unknown>;
    nested: Promise<unknown> | null;
  };
  const scopes = new AsyncLocalStorage<Scope>();
  let open: Scope | null = null;
  let closed: Promise<void> = Promise.resolve();
  const statements = new Map<string, Statement>();
  let executing = false;

  for (const name of GUARDED_METHODS) {
    const original = (sqlite[name] as (...args: unknown[]) => unknown).bind(sqlite);
    Object.assign(sqlite, {
      [name]: (...args: unknown[]) => {
        if (open && !executing) throw new SyncQueryInAsyncTransactionError();
        return original(...args);
      },
    });
  }

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
    executing = true;
    try {
      const statement = prepare(query);
      if (method === 'run') return { rows: [], ...statement.run(...(params as never[])) };
      const rows = statement.values(...(params as never[]));
      return { rows: method === 'get' ? rows[0] : rows };
    } finally {
      executing = false;
    }
  }

  function checkControl(scope: Scope, query: string): void {
    if (OPENING.test(query)) {
      if (scope.begun) throw new RawTransactionControlError();
      scope.begun = true;
    } else if (TRANSACTION_CONTROL.test(query) && !scope.sealed) {
      throw new RawTransactionControlError();
    }
  }

  function hasEnded(scope: Scope | undefined, query = ''): boolean {
    if (!scope) return false;
    if (scope.ended || scope.root.ended) return true;
    return (scope.sealed || scope.root.sealed) && !TRANSACTION_CONTROL.test(query);
  }

  async function gated(query: string, params: unknown[], method: Method) {
    const scope = scopes.getStore();
    if (scope) checkControl(scope, query);
    if (scope && ROLLBACK.test(query) && !sqlite.inTransaction) return { rows: [] };
    if (hasEnded(scope, query)) throw new TransactionEndedError();
    while (open && scope?.root !== open) await closed;
    while (scope?.nested) await scope.nested.catch(() => undefined);
    if (scope && !sqlite.inTransaction && !BEGIN.test(query)) {
      scope.root.ended = true;
      throw new TransactionRolledBackError();
    }
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
    (queries): Promise<Result[]> => transaction(() => runInOrder(queries)),
    { schema }
  );

  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
  type Behavior = 'deferred' | 'immediate' | 'exclusive';
  const begin = db.transaction.bind(db);

  async function sealWhenSettled<T>(scope: Scope, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } finally {
      scope.sealed = true;
    }
  }

  function joinOpen<T>(parent: Scope, callback: (tx: Transaction) => Promise<T>): Promise<T> {
    const run = parent.queue.then(() => {
      if (hasEnded(parent)) throw new TransactionEndedError();
      const child = {
        ended: false,
        sealed: false,
        begun: false,
        root: parent.root,
        queue: Promise.resolve(),
        nested: null,
      } as Scope;
      const savepoint = scopes.run(child, () =>
        parent.tx.transaction((tx) => {
          child.tx = tx;
          return sealWhenSettled(child, () => callback(tx));
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
    if (hasEnded(outer)) throw new TransactionEndedError();
    if (outer) return joinOpen(outer, callback);
    while (open) await closed;
    let close: () => void = () => undefined;
    closed = new Promise((resolve) => {
      close = resolve;
    });
    const scope = {
      ended: false,
      sealed: false,
      begun: false,
      queue: Promise.resolve(),
      nested: null,
    } as Scope;
    scope.root = scope;
    open = scope;
    try {
      return await scopes.run(scope, () =>
        begin(
          (tx) => {
            scope.tx = tx;
            return sealWhenSettled(scope, () => callback(tx));
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

  function outsideTransaction<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    return scopes.exit(() => Promise.resolve().then(fn));
  }

  Object.assign(db, { transaction });
  return {
    db: db as typeof db & { transaction: typeof transaction },
    transaction,
    outsideTransaction,
  };
}
