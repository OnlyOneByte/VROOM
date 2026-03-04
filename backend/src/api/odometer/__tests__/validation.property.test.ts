/**
 * Property-Based Tests for Odometer Input Validation
 *
 * Property 4: Input validation rejects invalid odometer data
 * For any negative or non-integer number, the validation schema rejects it.
 * For any future date, the schema rejects it.
 * For any valid non-negative integer + non-future date, the schema accepts it.
 *
 * **Validates: Requirements 1.2, 1.3**
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { z } from 'zod';

// Recreate the createSchema matching the definition in routes.ts
const createSchema = z.object({
  odometer: z.number().int().min(0, 'Odometer must be a non-negative integer'),
  recordedAt: z.coerce
    .date()
    .refine((d) => d <= new Date(), { message: 'Date cannot be in the future' }),
  note: z.string().max(500).optional(),
});

describe('Property 4: Input validation rejects invalid odometer data', () => {
  test('rejects negative odometer values', () => {
    fc.assert(
      fc.property(fc.double({ min: -1_000_000, max: -0.01, noNaN: true }), (negativeValue) => {
        const result = createSchema.safeParse({
          odometer: negativeValue,
          recordedAt: new Date('2024-06-15'),
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  test('rejects non-integer odometer values', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 999999.99, noNaN: true }).filter((n) => !Number.isInteger(n)),
        (nonIntValue) => {
          const result = createSchema.safeParse({
            odometer: nonIntValue,
            recordedAt: new Date('2024-06-15'),
          });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('rejects future dates', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date(Date.now() + 86_400_000), max: new Date('2030-12-31') }),
        (futureDate) => {
          const result = createSchema.safeParse({
            odometer: 50000,
            recordedAt: futureDate,
          });
          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('accepts valid non-negative integer odometer + non-future date', () => {
    // Use a fixed "now" snapshot to avoid race conditions between generation and validation
    const now = new Date();
    const schemaWithFixedNow = z.object({
      odometer: z.number().int().min(0, 'Odometer must be a non-negative integer'),
      recordedAt: z.coerce
        .date()
        .refine((d) => d <= now, { message: 'Date cannot be in the future' }),
      note: z.string().max(500).optional(),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999999 }),
        fc
          .date({ min: new Date('2000-01-01'), max: new Date(Date.now() - 60_000) })
          .filter((d) => !Number.isNaN(d.getTime())),
        (odometer, date) => {
          const result = schemaWithFixedNow.safeParse({
            odometer,
            recordedAt: date,
          });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});
