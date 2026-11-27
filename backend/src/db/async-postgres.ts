import { AsyncLocalStorage } from 'node:async_hooks';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pg-proxy';
import {
  insideAny,
  lateQuery,
  OPENING,
  RawTransactionControlError,
  statementHead,
  TRANSACTION_CONTROL,
} from './async-sqlite';
import * as schema from './pg/schema';

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

interface BunReservedSql {
  unsafe(
    text: string,
    params: unknown[]
  ): PromiseLike<unknown[]> & {
    values(): PromiseLike<unknown[]>;
  };
}

export function bunSqlConnection(reserved: BunReservedSql): PgConnection {
  return {
    async query(text, params, rowMode) {
      const query = reserved.unsafe(text, params);
      return rowMode === 'array' ? query.values() : query;
    },
  };
}

const POSTGRES_CONTROL = /^(start\s+transaction|abort|prepare\s+transaction)\b/i;

type Behavior = 'deferred' | 'immediate' | 'exclusive';

interface Scope {
  root: Scope;
  depth: number;
  ended: boolean;
  sealed: boolean;
  queue: Promise<unknown>;
  nested: Promise<unknown> | null;
}

export function openAsyncPostgres(connection: PgConnection) {
  const scopes = new AsyncLocalStorage<Scope>();
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

  async function statement(text: string, params: unknown[], rowMode: RowMode) {
    await control('SAVEPOINT vroom_statement');
    try {
      const rows = await connection.query(text, params, rowMode);
      await control('RELEASE SAVEPOINT vroom_statement');
      return rows;
    } catch (error) {
      await control('ROLLBACK TO SAVEPOINT vroom_statement');
      await control('RELEASE SAVEPOINT vroom_statement');
      throw error;
    }
  }

  async function gated(text: string, params: unknown[], method: 'all' | 'execute') {
    const scope = scopes.getStore();
    const head = statementHead(text);
    if (OPENING.test(head) || TRANSACTION_CONTROL.test(head) || POSTGRES_CONTROL.test(head)) {
      throw new RawTransactionControlError();
    }
    if (scope && ended(scope)) throw lateQuery();
    while (open && scope?.root !== open) await closed;
    while (scope?.nested) await scope.nested.catch(() => undefined);
    const rowMode = method === 'all' ? 'array' : 'object';
    const rows = await serial(() =>
      scope ? statement(text, params, rowMode) : connection.query(text, params, rowMode)
    );
    return { rows };
  }

  const db = drizzle(gated, { schema });
  type Db = typeof db;

  async function sealWhenSettled<T>(scope: Scope, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } finally {
      scope.sealed = true;
    }
  }

  function joinOpen<T>(parent: Scope, callback: (tx: Db) => Promise<T>): Promise<T> {
    const run = parent.queue.then(async () => {
      if (ended(parent)) throw lateQuery();
      const child: Scope = {
        root: parent.root,
        depth: parent.depth + 1,
        ended: false,
        sealed: false,
        queue: Promise.resolve(),
        nested: null,
      };
      const name = `vroom_tx_${child.depth}`;
      const body = (async () => {
        await serial(() => control(`SAVEPOINT ${name}`));
        try {
          const result = await scopes.run(child, () => sealWhenSettled(child, () => callback(db)));
          await serial(() => control(`RELEASE SAVEPOINT ${name}`));
          return result;
        } catch (error) {
          await serial(async () => {
            await control(`ROLLBACK TO SAVEPOINT ${name}`);
            await control(`RELEASE SAVEPOINT ${name}`);
          });
          throw error;
        }
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
    const outer = scopes.getStore();
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
      queue: Promise.resolve(),
      nested: null,
    } as Omit<Scope, 'root'> as Scope;
    scope.root = scope;
    open = scope;
    try {
      const snapshot = config.behavior === 'deferred';
      await serial(() => control(snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN'));
      let result: T;
      try {
        result = await insideAny.run(true, () =>
          scopes.run(scope, () => sealWhenSettled(scope, () => callback(db)))
        );
      } catch (error) {
        await serial(() => control('ROLLBACK'));
        throw error;
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
    return insideAny.run(false, () => scopes.exit(() => Promise.resolve().then(fn)));
  }

  Object.assign(db, { transaction });
  return {
    db: db as Db & { transaction: typeof transaction },
    transaction,
    outsideTransaction,
  };
}

export type AsyncPgDatabase = ReturnType<typeof openAsyncPostgres>['db'];
