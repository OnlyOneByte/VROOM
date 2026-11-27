import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import {
  NetworkInsideTransactionError,
  takeTransactionViolations,
} from '../../test-helpers/transaction-guard';
import { outboundResolver } from '../../utils/outbound-url';
import { inAsyncTransaction, openAsyncDatabase } from '../async-sqlite';

function setup() {
  return openAsyncDatabase(new Database(':memory:'));
}

describe('network calls stay outside async transactions', () => {
  test('the marker is set inside a transaction and its savepoints, and clear outside', async () => {
    const { db, transaction, outsideTransaction } = setup();
    const seen: Record<string, boolean> = { before: inAsyncTransaction() };
    await transaction(async () => {
      seen.inside = inAsyncTransaction();
      await db.transaction(async () => {
        seen.nested = inAsyncTransaction();
      });
      await outsideTransaction(() => {
        seen.outside = inAsyncTransaction();
      });
    });
    seen.after = inAsyncTransaction();
    expect(seen).toEqual({
      before: false,
      inside: true,
      nested: true,
      outside: false,
      after: false,
    });
  });

  test('a network call inside a transaction is refused and recorded, even when caught', async () => {
    const { transaction } = setup();
    let caught: unknown;
    await transaction(async () => {
      try {
        await fetch('http://127.0.0.1:9/never');
      } catch (error) {
        caught = error;
      }
      await outboundResolver.lookup('example.com').catch(() => undefined);
    });
    expect(caught).toBeInstanceOf(NetworkInsideTransactionError);
    expect(takeTransactionViolations()).toEqual(['fetch', 'An outbound DNS lookup']);
  });

  test('a stub a test assigns is guarded too, and restoring the original does not stack', async () => {
    const { transaction } = setup();
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async () => {
      calls.push('stub');
      return new Response('ok');
    }) as unknown as typeof fetch;
    try {
      expect(await (await fetch('http://stub.test')).text()).toBe('ok');
      await transaction(async () => {
        await fetch('http://stub.test').catch(() => undefined);
      });
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toEqual(['stub']);
    expect(takeTransactionViolations()).toEqual(['fetch']);
    expect(globalThis.fetch).toBe(original);
  });
});
