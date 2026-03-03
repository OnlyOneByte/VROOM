/**
 * Property 9: Split config validation correctness
 *
 * Valid configs with correct method, non-empty vehicles, non-negative amounts,
 * percentages in [0,100] are accepted; invalid configs are rejected.
 *
 * **Validates: Requirements 3.1, 3.3, 3.4**
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { splitConfigSchema } from '../validation';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const vehicleIdArb = fc.stringMatching(/^v[a-z0-9]{1,10}$/);

const vehicleIdsArb = fc
  .uniqueArray(vehicleIdArb, { minLength: 1, maxLength: 10 })
  .filter((ids) => ids.length >= 1);

// --- Valid config generators ---

const validEvenConfigArb = vehicleIdsArb.map((vehicleIds) => ({
  method: 'even' as const,
  vehicleIds,
}));

const validAbsoluteConfigArb = vehicleIdsArb.chain((vehicleIds) =>
  fc
    .array(
      fc.double({ min: 0, max: 10000, noNaN: true }).map((v) => Math.round(v * 100) / 100),
      {
        minLength: vehicleIds.length,
        maxLength: vehicleIds.length,
      }
    )
    .map((amounts) => ({
      method: 'absolute' as const,
      allocations: vehicleIds.map((vehicleId, i) => ({
        vehicleId,
        amount: amounts[i],
      })),
    }))
);

const validPercentageConfigArb = vehicleIdsArb.chain((vehicleIds) =>
  fc
    .array(
      fc.double({ min: 0, max: 100, noNaN: true }).map((v) => Math.round(v * 100) / 100),
      {
        minLength: vehicleIds.length,
        maxLength: vehicleIds.length,
      }
    )
    .map((percentages) => ({
      method: 'percentage' as const,
      allocations: vehicleIds.map((vehicleId, i) => ({
        vehicleId,
        percentage: percentages[i],
      })),
    }))
);

const validConfigArb = fc.oneof(
  validEvenConfigArb,
  validAbsoluteConfigArb,
  validPercentageConfigArb
);

// --- Invalid config generators ---

/** Even split with empty vehicleIds array */
const invalidEvenEmptyArb = fc.constant({
  method: 'even' as const,
  vehicleIds: [] as string[],
});

/** Absolute split with negative amount */
const invalidAbsoluteNegativeArb = vehicleIdsArb.chain((vehicleIds) =>
  fc.double({ min: -10000, max: -0.01, noNaN: true }).map((negAmount) => ({
    method: 'absolute' as const,
    allocations: vehicleIds.map((vehicleId) => ({
      vehicleId,
      amount: Math.round(negAmount * 100) / 100,
    })),
  }))
);

/** Absolute split with empty allocations */
const invalidAbsoluteEmptyArb = fc.constant({
  method: 'absolute' as const,
  allocations: [] as Array<{ vehicleId: string; amount: number }>,
});

/** Percentage split with value > 100 */
const invalidPercentageOverArb = vehicleIdsArb.chain((vehicleIds) =>
  fc.double({ min: 100.01, max: 1000, noNaN: true }).map((overPct) => ({
    method: 'percentage' as const,
    allocations: vehicleIds.map((vehicleId) => ({
      vehicleId,
      percentage: Math.round(overPct * 100) / 100,
    })),
  }))
);

/** Percentage split with negative value */
const invalidPercentageNegativeArb = vehicleIdsArb.chain((vehicleIds) =>
  fc.double({ min: -1000, max: -0.01, noNaN: true }).map((negPct) => ({
    method: 'percentage' as const,
    allocations: vehicleIds.map((vehicleId) => ({
      vehicleId,
      percentage: Math.round(negPct * 100) / 100,
    })),
  }))
);

/** Percentage split with empty allocations */
const invalidPercentageEmptyArb = fc.constant({
  method: 'percentage' as const,
  allocations: [] as Array<{ vehicleId: string; percentage: number }>,
});

/** Even split with empty-string vehicleId */
const invalidEvenEmptyIdArb = fc.constant({
  method: 'even' as const,
  vehicleIds: [''],
});

// ---------------------------------------------------------------------------
// Property 9: Split config validation correctness
// **Validates: Requirements 3.1, 3.3, 3.4**
// ---------------------------------------------------------------------------
describe('Property 9: Split config validation correctness', () => {
  test('valid split configs are accepted by the schema', () => {
    fc.assert(
      fc.property(validConfigArb, (config) => {
        const result = splitConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  test('even split with empty vehicleIds is rejected', () => {
    fc.assert(
      fc.property(invalidEvenEmptyArb, (config) => {
        const result = splitConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('even split with empty-string vehicleId is rejected', () => {
    fc.assert(
      fc.property(invalidEvenEmptyIdArb, (config) => {
        const result = splitConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('absolute split with negative amounts is rejected', () => {
    fc.assert(
      fc.property(invalidAbsoluteNegativeArb, (config) => {
        const result = splitConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('absolute split with empty allocations is rejected', () => {
    fc.assert(
      fc.property(invalidAbsoluteEmptyArb, (config) => {
        const result = splitConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('percentage split with values > 100 is rejected', () => {
    fc.assert(
      fc.property(invalidPercentageOverArb, (config) => {
        const result = splitConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('percentage split with negative values is rejected', () => {
    fc.assert(
      fc.property(invalidPercentageNegativeArb, (config) => {
        const result = splitConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('percentage split with empty allocations is rejected', () => {
    fc.assert(
      fc.property(invalidPercentageEmptyArb, (config) => {
        const result = splitConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('config with invalid method is rejected', () => {
    const invalidMethodArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => !['even', 'absolute', 'percentage'].includes(s))
      .map((method) => ({ method, vehicleIds: ['v1'] }));

    fc.assert(
      fc.property(invalidMethodArb, (config) => {
        const result = splitConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 }
    );
  });
});
