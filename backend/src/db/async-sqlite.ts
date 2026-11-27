import type { Database, Statement } from 'bun:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { drizzle, type SqliteRemoteResult } from 'drizzle-orm/sqlite-proxy';
import { UPKEEP_QUERIES } from './dialect';
import * as schema from './schema';

const STATEMENT_CACHE_SIZE = 500;
const TRANSACTION_CONTROL = /^(commit|end|rollback|release)\b/i;
const OPENING = /^(begin|savepoint)\b/i;
const BEGIN = /^begin\b/i;
const ROLLBACK = /^rollback\b/i;
const LEADING_WHITESPACE_SEMICOLONS_AND_COMMENTS =
  /^(?:[\s;]+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?(?:\*\/|$))*/;

function statementHead(query: string): string {
  return query.replace(LEADING_WHITESPACE_SEMICOLONS_AND_COMMENTS, '');
}
const GUARDED_METHODS = ['prepare', 'query', 'run', 'exec', 'transaction'] as const;
const RAW_QUERY_METHODS = ['run', 'all', 'get', 'values'] as const;

type SqlSource = string | { getSQL(): unknown };
type Dialect = { sqlToQuery(sql: unknown): { sql: string } };

function refuseRawControl(target: object, dialect: Dialect, currentSession: () => object): void {
  for (const name of RAW_QUERY_METHODS) {
    const original = (target as Record<string, (query: SqlSource) => unknown>)[name];
    Object.assign(target, {
      [name](query: SqlSource) {
        const text = statementHead(
          typeof query === 'string' ? query : dialect.sqlToQuery(query.getSQL()).sql
        );
        if (OPENING.test(text) || TRANSACTION_CONTROL.test(text)) {
          throw new RawTransactionControlError();
        }
        const session = currentSession();
        const pinned = Object.create(target, {
          session: { value: name === 'all' || name === 'get' ? named(session) : session },
        });
        return original.call(pinned, query);
      },
    });
  }
}

type Method = 'run' | 'all' | 'values' | 'get' | 'namedAll' | 'namedGet';
type RawClient = (query: string, params: unknown[], method: Method) => Promise<unknown>;

function named(session: object): object {
  const { client } = session as { client: RawClient };
  return Object.create(session, {
    client: {
      value: (query: string, params: unknown[], method: Method) =>
        client(
          query,
          params,
          method === 'all' ? 'namedAll' : method === 'get' ? 'namedGet' : method
        ),
    },
  });
}

export class TransactionEndedError extends Error {
  constructor() {
    super('A query ran after its transaction had ended; await every query inside the callback');
  }
}

let lateQueryListener: ((error: TransactionEndedError) => void) | null = null;

export function reportLateQueries(listener: ((error: TransactionEndedError) => void) | null): void {
  lateQueryListener = listener;
}

function lateQuery(): TransactionEndedError {
  const error = new TransactionEndedError();
  lateQueryListener?.(error);
  return error;
}

export class TransactionRolledBackError extends Error {
  constructor() {
    super('SQLite rolled this transaction back after an earlier error, so the rest was refused');
  }
}

export class RawTransactionControlError extends Error {
  constructor() {
    super('Raw BEGIN, COMMIT, END, ROLLBACK, SAVEPOINT or RELEASE is refused; use transaction()');
  }
}

export class SyncQueryInAsyncTransactionError extends Error {
  constructor() {
    super(
      'A synchronous query ran on this connection while an async transaction was open; move it to the async database'
    );
  }
}

const insideAny = new AsyncLocalStorage<boolean>();

export function inAsyncTransaction(): boolean {
  return insideAny.getStore() === true;
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
export type AsyncHandle = BaseSQLiteDatabase<'async', SqliteRemoteResult, typeof schema>;
export type AsyncTransaction = Parameters<Parameters<AsyncAppDatabase['transaction']>[0]>[0];

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
  const outside = new AsyncLocalStorage<true>();
  type Client = (query: string, params: unknown[], method: Method) => Promise<unknown>;
  type Session = { client: Client };
  const scopedSessions = new WeakMap<Scope, Session>();
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

  function upkeep(kind: keyof typeof UPKEEP_QUERIES): unknown {
    const was = executing;
    executing = true;
    try {
      return sqlite.query(UPKEEP_QUERIES[kind]).get();
    } finally {
      executing = was;
    }
  }

  function execute(query: string, params: unknown[], method: Method) {
    executing = true;
    try {
      const statement = prepare(query);
      if (method === 'run') return { rows: [], ...statement.run(...(params as never[])) };
      if (method === 'namedAll') return { rows: statement.all(...(params as never[])) };
      if (method === 'namedGet') {
        return { rows: (statement.get(...(params as never[])) ?? undefined) as never };
      }
      const rows = statement.values(...(params as never[]));
      return { rows: method === 'get' ? rows[0] : rows };
    } finally {
      executing = false;
    }
  }

  function checkControl(scope: Scope | undefined, query: string): void {
    if (!scope) {
      if (OPENING.test(query) || TRANSACTION_CONTROL.test(query)) {
        throw new RawTransactionControlError();
      }
    } else if (OPENING.test(query)) {
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
    const head = statementHead(query);
    checkControl(scope, head);
    if (scope && ROLLBACK.test(head) && !sqlite.inTransaction) return { rows: [] };
    if (hasEnded(scope, head)) throw lateQuery();
    while (open && scope?.root !== open) await closed;
    while (scope?.nested) await scope.nested.catch(() => undefined);
    if (scope && !sqlite.inTransaction && !BEGIN.test(head)) {
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
  const dialect = (db as unknown as { dialect: Dialect }).dialect;
  const baseSession = (db as unknown as { session: Session }).session;
  const currentSession = () => sessionFor(scopes.getStore());
  refuseRawControl(db, dialect, currentSession);
  bindBuildersToScope(db);

  function sessionFor(scope: Scope | undefined): Session {
    if (!scope) return baseSession;
    let session = scopedSessions.get(scope);
    if (!session) {
      const client: Client = (query, params, method) =>
        scopes.getStore() || outside.getStore()
          ? baseSession.client(query, params, method)
          : scopes.run(scope, () => baseSession.client(query, params, method));
      session = Object.create(baseSession, { client: { value: client } }) as Session;
      scopedSessions.set(scope, session);
    }
    return session;
  }

  function bindBuildersToScope(target: object): void {
    const relational = Object.values((target as { query: object }).query);
    for (const holder of [target, ...relational]) {
      Object.defineProperty(holder, 'session', {
        configurable: true,
        get: currentSession,
      });
    }
  }

  async function sealWhenSettled<T>(scope: Scope, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } finally {
      scope.sealed = true;
    }
  }

  function joinOpen<T>(parent: Scope, callback: (tx: Transaction) => Promise<T>): Promise<T> {
    const run = parent.queue.then(() => {
      if (hasEnded(parent)) throw lateQuery();
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
          refuseRawControl(tx, dialect, currentSession);
          bindBuildersToScope(tx);
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
    if (hasEnded(outer)) throw lateQuery();
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
      return await insideAny.run(true, () =>
        scopes.run(scope, () =>
          begin(
            (tx) => {
              refuseRawControl(tx, dialect, currentSession);
              bindBuildersToScope(tx);
              scope.tx = tx;
              return sealWhenSettled(scope, () => callback(tx));
            },
            { behavior: config.behavior ?? 'immediate' }
          )
        )
      );
    } finally {
      scope.ended = true;
      open = null;
      close();
    }
  }

  function outsideTransaction<T>(fn: () => T | PromiseLike<T>): Promise<T> {
    return insideAny.run(false, () =>
      scopes.exit(() => outside.run(true, () => Promise.resolve().then(fn)))
    );
  }

  Object.assign(db, { transaction });
  return {
    db: db as typeof db & { transaction: typeof transaction },
    transaction,
    outsideTransaction,
    upkeep,
  };
}
