import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { allocate, type GroupRule, settle, splitGroup } from '../split';

const IDS = ['a', 'b', 'c'] as const;
const sumOf = (m: Map<string, number>) => [...m.values()].reduce((n, v) => n + v, 0);

const rule: fc.Arbitrary<GroupRule> = fc.oneof(
  fc.constant({ kind: 'distance' } as const),
  fc.constant({ kind: 'equal' } as const),
  fc.constant({ kind: 'payer' } as const),
  fc.constant({ kind: 'fixed', shares: { a: 70, b: 20, c: 10 } } as const)
);

const input = fc
  .record({
    payments: fc.array(
      fc.record({
        payer: fc.constantFrom('a', 'b', 'c', null),
        cents: fc.integer({ min: 1, max: 50_000 }),
      }),
      { maxLength: 12 }
    ),
    distance: fc.tuple(fc.nat(2000), fc.nat(2000), fc.nat(2000)),
    unattributed: fc.nat(2000),
  })
  .map(({ payments, distance, unattributed }) => {
    const paidBy = new Map<string | null, number>();
    for (const p of payments) paidBy.set(p.payer, (paidBy.get(p.payer) ?? 0) + p.cents);
    return {
      total: payments.reduce((n, p) => n + p.cents, 0),
      paidBy,
      distance: new Map(IDS.map((id, i) => [id, distance[i] ?? 0])),
      unattributed,
      active: [...IDS],
    };
  });

describe('split rules', () => {
  test('allocate hands out every cent, in whole cents', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.nat(100), { minLength: 1 }),
        (total, ws) => {
          const weights = new Map(ws.map((w, i) => [`d${i}`, w]));
          const out = allocate(total, weights);
          if (ws.every((w) => w === 0)) return out.size === 0;
          return sumOf(out) === total && [...out.values()].every(Number.isInteger);
        }
      )
    );
  });

  test('under every rule, what drivers owe plus unassigned plus costs with no payer is exactly the group total', () => {
    fc.assert(
      fc.property(rule, input, (r, i) => {
        const { owed, unassigned } = splitGroup(r, i);
        return sumOf(owed) + unassigned + (i.paidBy.get(null) ?? 0) === i.total;
      })
    );
  });

  test('with nothing unassigned, what drivers owe is exactly what they paid, under every rule', () => {
    fc.assert(
      fc.property(rule, input, (r, i) => {
        const { owed, unassigned } = splitGroup(r, i);
        const paid = i.total - (i.paidBy.get(null) ?? 0);
        return unassigned !== 0 || sumOf(owed) === paid;
      })
    );
  });

  test('under Not split, a cost with no payer is never also counted as unassigned', () => {
    fc.assert(
      fc.property(input, (i) => {
        const { owed, unassigned } = splitGroup({ kind: 'payer' }, i);
        return unassigned === 0 && [...owed].every(([id, cents]) => cents === i.paidBy.get(id));
      })
    );
  });

  test('by distance, unattributed distance stays unassigned', () => {
    const { owed, unassigned } = splitGroup(
      { kind: 'distance' },
      {
        total: 10_000,
        paidBy: new Map([['a', 10_000]]),
        distance: new Map([
          ['a', 300],
          ['b', 100],
        ]),
        unattributed: 100,
        active: ['a', 'b'],
      }
    );
    expect(Object.fromEntries(owed)).toEqual({ a: 6000, b: 2000 });
    expect(unassigned).toBe(2000);
  });

  test('when balances do not cancel out, transfers never overshoot and only one side is left over', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50_000, max: 50_000 }), { minLength: 1, maxLength: 8 }),
        (values) => {
          const balances = new Map(values.map((v, i) => [`d${i}`, v]));
          const after = new Map(balances);
          for (const t of settle(balances)) {
            after.set(t.from, (after.get(t.from) ?? 0) - t.amount);
            after.set(t.to, (after.get(t.to) ?? 0) + t.amount);
          }
          const sameSide = [...after].every(
            ([id, v]) => v === 0 || Math.sign(v) === Math.sign(balances.get(id) ?? 0)
          );
          const left = [...after.values()].filter((v) => v !== 0);
          const oneSide = left.every((v) => v > 0) || left.every((v) => v < 0);
          const gap = values.reduce((n, v) => n + v, 0);
          return sameSide && oneSide && left.reduce((n, v) => n + v, 0) === gap;
        }
      )
    );
  });

  test('settling up zeroes every balance in at most n - 1 transfers', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50_000, max: 50_000 }), { minLength: 1, maxLength: 8 }),
        (raw) => {
          const values = [...raw.slice(0, -1), -raw.slice(0, -1).reduce((n, v) => n + v, 0)];
          const balances = new Map(values.map((v, i) => [`d${i}`, v]));
          const transfers = settle(balances);
          const after = new Map(balances);
          for (const t of transfers) {
            after.set(t.from, (after.get(t.from) ?? 0) - t.amount);
            after.set(t.to, (after.get(t.to) ?? 0) + t.amount);
          }
          const moving = values.filter((v) => v !== 0).length;
          return (
            [...after.values()].every((v) => v === 0) &&
            transfers.every((t) => t.amount > 0) &&
            transfers.length <= Math.max(moving - 1, 0)
          );
        }
      )
    );
  });
});
