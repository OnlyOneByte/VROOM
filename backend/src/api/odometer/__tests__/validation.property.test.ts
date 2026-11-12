import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { z } from 'zod';

const createSchema = z.object({
  odometer: z.number().int().min(0, 'Odometer must be a non-negative integer'),
  recordedAt: z.coerce
    .date()
    .refine((d) => d <= new Date(), { message: 'Date cannot be in the future' }),
  note: z.string().max(500).optional(),
});

describe('Input validation rejects invalid odometer data', () => {
  test('rejects negative odometer values', () => {
    fc.assert(
      fc.property(fc.double({ min: -1_000_000, max: -0.01, noNaN: true }), (negativeValue) => {
        const result = createSchema.safeParse({
          odometer: negativeValue,
          recordedAt: new Date('2024-06-15'),
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 50 }
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
      { numRuns: 50 }
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
      { numRuns: 50 }
    );
  });

  test('accepts valid non-negative integer odometer + non-future date', () => {
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
      { numRuns: 50 }
    );
  });
});
