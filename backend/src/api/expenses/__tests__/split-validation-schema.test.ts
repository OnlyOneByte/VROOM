/**
 * Unit tests for the split-expense validation schemas (C84 guard, steered by the C81 coverage
 * baseline — expenses/validation.ts was at 50% func / 73% line, the uncovered branches being the
 * financial-correctness REFINEMENTS). These guard real money-math: a percentage split must sum to
 * 100, absolute allocations must sum to the declared total, and source fields are both-or-neither.
 * Pure Zod schemas → no DB, no server; exercised via safeParse.
 */

import { describe, expect, test } from 'bun:test';
import { createSplitExpenseSchema, splitConfigSchema, updateSplitSchema } from '../validation';

const baseCreate = {
  category: 'fuel',
  date: '2024-03-15T00:00:00.000Z',
  totalAmount: 100,
};

describe('splitConfigSchema — discriminated union shape', () => {
  test('accepts each method with valid allocations', () => {
    expect(splitConfigSchema.safeParse({ method: 'even', vehicleIds: ['v1', 'v2'] }).success).toBe(
      true
    );
    expect(
      splitConfigSchema.safeParse({
        method: 'absolute',
        allocations: [{ vehicleId: 'v1', amount: 50 }],
      }).success
    ).toBe(true);
    expect(
      splitConfigSchema.safeParse({
        method: 'percentage',
        allocations: [{ vehicleId: 'v1', percentage: 100 }],
      }).success
    ).toBe(true);
  });

  test('rejects an empty vehicle/allocation list and an unknown method', () => {
    expect(splitConfigSchema.safeParse({ method: 'even', vehicleIds: [] }).success).toBe(false);
    expect(splitConfigSchema.safeParse({ method: 'absolute', allocations: [] }).success).toBe(
      false
    );
    expect(splitConfigSchema.safeParse({ method: 'bogus', vehicleIds: ['v1'] }).success).toBe(
      false
    );
    // A percentage allocation over 100 is rejected by the field schema.
    expect(
      splitConfigSchema.safeParse({
        method: 'percentage',
        allocations: [{ vehicleId: 'v1', percentage: 150 }],
      }).success
    ).toBe(false);
  });
});

describe('createSplitExpenseSchema — percentage-sum refinement (must total 100)', () => {
  test('accepts percentages that sum to 100', () => {
    const r = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      splitConfig: {
        method: 'percentage',
        allocations: [
          { vehicleId: 'v1', percentage: 60 },
          { vehicleId: 'v2', percentage: 40 },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  test('rejects percentages that do NOT sum to 100', () => {
    const r = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      splitConfig: {
        method: 'percentage',
        allocations: [
          { vehicleId: 'v1', percentage: 60 },
          { vehicleId: 'v2', percentage: 30 }, // sums to 90
        ],
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === 'Percentages must sum to 100')).toBe(true);
    }
  });
});

describe('createSplitExpenseSchema — absolute-sum refinement (must equal totalAmount)', () => {
  test('accepts absolute allocations that sum to totalAmount', () => {
    const r = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      totalAmount: 100,
      splitConfig: {
        method: 'absolute',
        allocations: [
          { vehicleId: 'v1', amount: 70 },
          { vehicleId: 'v2', amount: 30 },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  test('rejects absolute allocations that do NOT sum to totalAmount', () => {
    const r = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      totalAmount: 100,
      splitConfig: {
        method: 'absolute',
        allocations: [
          { vehicleId: 'v1', amount: 70 },
          { vehicleId: 'v2', amount: 20 }, // sums to 90, not 100
        ],
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.message === 'Absolute allocations must sum to total amount')
      ).toBe(true);
    }
  });
});

describe('createSplitExpenseSchema — source fields are both-or-neither', () => {
  test('accepts both source fields present (financing), or both absent', () => {
    const both = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      splitConfig: { method: 'even', vehicleIds: ['v1'] },
      sourceType: 'financing',
      sourceId: 'fin-1',
    });
    expect(both.success).toBe(true);

    const neither = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      splitConfig: { method: 'even', vehicleIds: ['v1'] },
    });
    expect(neither.success).toBe(true);
  });

  // #145 (C465): the manual split route accepts ONLY a 'financing' source link (mirrors the regular
  // create) — 'insurance_term'/'reminder' splits come EXCLUSIVELY from system paths that bypass this
  // route. Pre-fix the schema was z.string().optional() → a hand-crafted POST could forge an
  // UNVALIDATED reminder/insurance_term link on the caller's own siblings (skews source-bucketed
  // analytics; a real matching insurance_term sourceId cascade-deletes the manual split when the
  // policy is removed). NON-VACUOUS: pre-fix every line here parsed success:true.
  test('rejects a non-financing sourceType (reminder / insurance_term / arbitrary string) (#145)', () => {
    for (const sourceType of ['reminder', 'insurance_term', 'manual', 'anything']) {
      const r = createSplitExpenseSchema.safeParse({
        ...baseCreate,
        splitConfig: { method: 'even', vehicleIds: ['v1'] },
        sourceType,
        sourceId: 'x-1',
      });
      expect(r.success, `sourceType '${sourceType}' must be rejected`).toBe(false);
    }
  });

  test('rejects exactly one source field (type without id, or id without type)', () => {
    const typeOnly = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      splitConfig: { method: 'even', vehicleIds: ['v1'] },
      sourceType: 'reminder',
    });
    expect(typeOnly.success).toBe(false);

    const idOnly = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      splitConfig: { method: 'even', vehicleIds: ['v1'] },
      sourceId: 'rem-1',
    });
    expect(idOnly.success).toBe(false);
  });
});

// C408 (#104/C352 hole): the split-create schema's tags were a bare z.array(z.string()) that bypassed
// the tagElementSchema separator-rejection the regular create/update boundaries enforce. A tag containing
// ';' or ',' persisted onto every sibling, then the CSV export ('; '-join) → re-import (/[;,]/-split)
// round-tripped it into MULTIPLE tags (silent data loss). Now routed through the shared tagElementSchema.
// Pre-fix these REJECT-assertions were RED (the bare array accepted the separator tag).
describe('createSplitExpenseSchema — tags reject the CSV separator (#104, C408)', () => {
  const splitBase = {
    ...baseCreate,
    splitConfig: { method: 'even' as const, vehicleIds: ['v1', 'v2'] },
  };

  test('a tag containing a semicolon is rejected', () => {
    const r = createSplitExpenseSchema.safeParse({ ...splitBase, tags: ['road; trip'] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.message === 'Tag cannot contain a semicolon or comma')
      ).toBe(true);
    }
  });

  test('a tag containing a comma is rejected', () => {
    const r = createSplitExpenseSchema.safeParse({ ...splitBase, tags: ['errand,grocery'] });
    expect(r.success).toBe(false);
  });

  test('an empty tag is rejected (min(1), like the regular boundary)', () => {
    expect(createSplitExpenseSchema.safeParse({ ...splitBase, tags: [''] }).success).toBe(false);
  });

  test('separator-free tags still pass (control)', () => {
    const r = createSplitExpenseSchema.safeParse({
      ...splitBase,
      tags: ['road trip', 'business'],
    });
    expect(r.success).toBe(true);
  });
});

describe('updateSplitSchema — shares the same refinement', () => {
  test('absolute-sum refinement applies; totalAmount optional means the absolute check is skipped when omitted', () => {
    // With totalAmount present, the sum must match.
    const mismatch = updateSplitSchema.safeParse({
      totalAmount: 100,
      splitConfig: { method: 'absolute', allocations: [{ vehicleId: 'v1', amount: 50 }] },
    });
    expect(mismatch.success).toBe(false);

    // With totalAmount OMITTED, the absolute-sum check is skipped (data.totalAmount === undefined).
    const skipped = updateSplitSchema.safeParse({
      splitConfig: { method: 'absolute', allocations: [{ vehicleId: 'v1', amount: 50 }] },
    });
    expect(skipped.success).toBe(true);
  });

  test('percentage-sum refinement still applies on update', () => {
    const r = updateSplitSchema.safeParse({
      splitConfig: { method: 'percentage', allocations: [{ vehicleId: 'v1', percentage: 90 }] },
    });
    expect(r.success).toBe(false);
  });
});

// #141 (C458) + money-cents-migration: totalAmount is the dollars→integer-CENTS input edge at the
// validation boundary (centsAmount = z.number().positive().transform(dollarsToCents)). The split's
// groupTotal + legs are then all computed in native cents from this SAME value (Σlegs == groupTotal
// EXACTLY). A sub-cent dollar input rounds to the nearest whole cent (ROUND-before-int), never truncates.
// The UI only sends 2-decimal dollar amounts; this verifies the dollars→cents conversion.
describe('split totalAmount is converted to integer cents (#141 / money-cents-migration)', () => {
  test('a dollar totalAmount with a sub-cent tail rounds to whole cents on create', () => {
    const r = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      splitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
      totalAmount: 100.005,
    });
    expect(r.success).toBe(true);
    // $100.005 → round(100.005 * 100) = 10001 cents.
    if (r.success) expect(r.data.totalAmount).toBe(10001);
  });

  test('a dollar totalAmount with a sub-cent tail rounds on update too', () => {
    const r = updateSplitSchema.safeParse({
      splitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
      totalAmount: 49.999,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.totalAmount).toBe(5000); // $49.999 → 5000 cents
  });

  test('a clean 2-decimal dollar totalAmount converts to its exact cent value', () => {
    const r = createSplitExpenseSchema.safeParse({
      ...baseCreate,
      splitConfig: { method: 'even', vehicleIds: ['v1', 'v2'] },
      totalAmount: 100.0,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.totalAmount).toBe(10000); // $100.00 → 10000 cents
  });
});
