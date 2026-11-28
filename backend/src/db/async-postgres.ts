import { AsyncLocalStorage } from 'node:async_hooks';
import type { PGlite } from '@electric-sql/pglite';
import type { ReservedSQL } from 'bun';
import { drizzle } from 'drizzle-orm/pg-proxy';
import {
  type AsyncAppDatabase,
  insideAny,
  lateQuery,
  OPENING,
  RawTransactionControlError,
  statementHead,
  TRANSACTION_CONTROL,
  TransactionRolledBackError,
} from './async-sqlite';
import * as schema from './pg/schema';
import { noteStatement } from './statement-count';

type RowMode = 'array' | 'object';

export interface PgConnection {
  query(text: string, params: unknown[], rowMode: RowMode): Promise<unknown[]>;
}

export function pgliteConnection(client: PGlite): PgConnection {
  return {
    async query(text, params, rowMode) {
      return (await client.query(text, params, { rowMode })).rows;
    },
  };
}

type BunReservedSql = Pick<ReservedSQL, 'unsafe'>;

export function bunSqlConnection(reserved: BunReservedSql): PgConnection {
  return {
    async query(text, params, rowMode) {
      const query = reserved.unsafe(text, params);
      return rowMode === 'array' ? query.values() : query;
    },
  };
}

const POSTGRES_CONTROL = /^(start\s+transaction|abort|prepare\s+transaction)\b/i;
const QUOTED_OR_COMMENT = /'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g;

export class MultipleStatementsError extends Error {
  constructor() {
    super('One query may hold one statement; split it into separate queries');
  }
}

function hasSecondStatement(text: string): boolean {
  return /;\s*\S/.test(text.replace(QUOTED_OR_COMMENT, ''));
}

type Behavior = 'deferred' | 'immediate' | 'exclusive';

interface Scope {
  root: Scope;
  depth: number;
  ended: boolean;
  sealed: boolean;
  aborted: boolean;
  queue: Promise<unknown>;
  nested: Promise<unknown> | null;
}

const RETRY = Symbol('retry');

type Client = (
  text: string,
  params: unknown[],
  method: 'all' | 'execute'
) => Promise<{
  rows: unknown[];
}>;

export function openAsyncPostgres(connection: PgConnection) {
  const scopes = new AsyncLocalStorage<Scope>();
  const outside = new AsyncLocalStorage<true>();
  let open: Scope | null = null;
  let closed: Promise<void> = Promise.resolve();
  let chain: Promise<unknown> = Promise.resolve();

  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  }

  const control = (text: string) => connection.query(text, [], 'object');

  const ended = (scope: Scope) => scope.ended || scope.sealed || scope.root.ended;

  function current(captured: Scope | undefined): Scope | undefined {
    if (outside.getStore()) return undefined;
    return scopes.getStore() ?? captured;
  }

  function refuseRaw(text: string): void {
    const head = statementHead(text);
    if (OPENING.test(head) || TRANSACTION_CONTROL.test(head) || POSTGRES_CONTROL.test(head)) {
      throw new RawTransactionControlError();
    }
    if (hasSecondStatement(text)) throw new MultipleStatementsError();
  }

  function onConnection(scope: Scope | undefined): boolean {
    if (!scope) return open === null;
    return open === scope.root && !scope.nested;
  }

  async function statement(scope: Scope, text: string, params: unknown[], rowMode: RowMode) {
    await control('SAVEPOINT vroom_statement').catch((error: unknown) => {
      scope.root.aborted = true;
      throw error;
    });
    let rows: unknown[];
    try {
      rows = await connection.query(text, params, rowMode);
    } catch (error) {
      await control('ROLLBACK TO SAVEPOINT vroom_statement')
        .then(() => control('RELEASE SAVEPOINT vroom_statement'))
        .catch(() => {
          scope.root.aborted = true;
        });
      throw error;
    }
    await control('RELEASE SAVEPOINT vroom_statement').catch((error: unknown) => {
      scope.root.aborted = true;
      throw error;
    });
    return rows;
  }

  async function gated(
    captured: Scope | undefined,
    text: string,
    params: unknown[],
    method: 'all' | 'execute'
  ) {
    const scope = current(captured);
    refuseRaw(text);
    const rowMode = method === 'all' ? 'array' : 'object';
    for (;;) {
      await waitForTurn(scope);
      const rows = await serial(() => sendIfTurn(scope, text, params, rowMode));
      if (rows !== RETRY) return { rows };
    }
  }

  async function waitForTurn(scope: Scope | undefined): Promise<void> {
    if (scope && ended(scope)) throw lateQuery();
    while (open && scope?.root !== open) await closed;
    while (scope?.nested) await scope.nested.catch(() => undefined);
  }

  async function sendIfTurn(
    scope: Scope | undefined,
    text: string,
    params: unknown[],
    rowMode: RowMode
  ): Promise<unknown[] | typeof RETRY> {
    if (scope && ended(scope)) throw lateQuery();
    if (scope?.root.aborted) throw new TransactionRolledBackError();
    if (!onConnection(scope)) return RETRY;
    noteStatement();
    if (!scope) return connection.query(text, params, rowMode);
    return statement(scope, text, params, rowMode);
  }

  const clientFor =
    (captured: Scope | undefined): Client =>
    (text, params, method) =>
      gated(captured, text, params, method);

  const db = drizzle(clientFor(undefined), { schema });
  type Db = typeof db;
  type Session = { client: Client };
  const baseSession = (db as unknown as { session: Session }).session;
  const scopedSessions = new WeakMap<Scope, Session>();

  function sessionFor(scope: Scope | undefined): Session {
    if (!scope) return baseSession;
    let session = scopedSessions.get(scope);
    if (!session) {
      session = Object.create(baseSession, { client: { value: clientFor(scope) } }) as Session;
      scopedSessions.set(scope, session);
    }
    return session;
  }

  const relational = Object.values((db as unknown as { query: object }).query);
  for (const holder of [db, ...relational]) {
    Object.defineProperty(holder, 'session', {
      configurable: true,
      get: () => sessionFor(outside.getStore() ? undefined : scopes.getStore()),
    });
  }

  async function sealWhenSettled<T>(scope: Scope, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } finally {
      scope.sealed = true;
    }
  }

  function controlIn(scope: Scope, text: string): Promise<unknown> {
    return serial(async () => {
      if (scope.root.ended || open !== scope.root) throw lateQuery();
      return control(text);
    });
  }

  function joinOpen<T>(parent: Scope, callback: (tx: Db) => Promise<T>): Promise<T> {
    const run = parent.queue.then(async () => {
      if (ended(parent)) throw lateQuery();
      const child: Scope = {
        root: parent.root,
        depth: parent.depth + 1,
        ended: false,
        sealed: false,
        aborted: false,
        queue: Promise.resolve(),
        nested: null,
      };
      const name = `vroom_tx_${child.depth}`;
      const body = (async () => {
        await controlIn(child, `SAVEPOINT ${name}`);
        let result: T;
        try {
          result = await scopes.run(child, () => sealWhenSettled(child, () => callback(db)));
        } catch (error) {
          await controlIn(child, `ROLLBACK TO SAVEPOINT ${name}`).catch(() => {
            child.root.aborted = true;
          });
          throw error;
        }
        await controlIn(child, `RELEASE SAVEPOINT ${name}`).catch((error: unknown) => {
          child.root.aborted = true;
          throw error;
        });
        return result;
      })();
      parent.nested = body;
      return body.finally(() => {
        child.ended = true;
        parent.nested = null;
      });
    });
    parent.queue = run.catch(() => undefined);
    return run;
  }

  async function transaction<T>(
    callback: (tx: Db) => Promise<T>,
    config: { behavior?: Behavior } = {}
  ): Promise<T> {
    const outer = outside.getStore() ? undefined : scopes.getStore();
    if (outer) {
      if (ended(outer)) throw lateQuery();
      return joinOpen(outer, callback);
    }
    while (open) await closed;
    let close: () => void = () => undefined;
    closed = new Promise((resolve) => {
      close = resolve;
    });
    const scope = {
      depth: 0,
      ended: false,
      sealed: false,
      aborted: false,
      queue: Promise.resolve(),
      nested: null,
    } as Omit<Scope, 'root'> as Scope;
    scope.root = scope;
    open = scope;
    try {
      const snapshot = config.behavior === 'deferred';
      await serial(() =>
        control(snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN')
      );
      let result: T;
      try {
        result = await insideAny.run(true, () =>
          scopes.run(scope, () => sealWhenSettled(scope, () => callback(db)))
        );
      } catch (error) {
        await serial(() => control('ROLLBACK')).catch(() => undefined);
        throw error;
      }
      if (scope.aborted) {
        await serial(() => control('ROLLBACK')).catch(() => undefined);
        throw new TransactionRolledBackError();
      }
      await serial(() => control('COMMIT'));
      return result;
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
    db: db as Db & { transaction: typeof transaction },
    transaction,
    outsideTransaction,
  };
}

export type AsyncPgDatabase = ReturnType<typeof openAsyncPostgres>['db'];

export function portableDatabase(db: AsyncPgDatabase): AsyncAppDatabase {
  return db as unknown as AsyncAppDatabase;
}
