import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ALLOWED_MIME_TYPES } from '../../photos/photo-service';
import { createTermSchema, updateTermSchema } from '../validation';
import { validTermInputArb } from './insurance-test-generators';

describe('insurance validation accepts flat term fields', () => {
  test('valid flat terms with vehicleCoverage should parse successfully', () => {
    fc.assert(
      fc.property(validTermInputArb, (term) => {
        const input = {
          ...term,
          vehicleCoverage: { vehicleIds: ['v-1'] },
        };
        const result = createTermSchema.safeParse(input);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test('terms with startDate equal to endDate should be rejected', () => {
    fc.assert(
      fc.property(validTermInputArb, (term) => {
        const input = {
          ...term,
          endDate: term.startDate,
          vehicleCoverage: { vehicleIds: ['v-1'] },
        };
        const result = createTermSchema.safeParse(input);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('terms with negative deductibleAmount should be rejected', () => {
    fc.assert(
      fc.property(validTermInputArb, (term) => {
        const input = {
          ...term,
          deductibleAmount: -(Math.random() * 1000 + 0.01),
          vehicleCoverage: { vehicleIds: ['v-1'] },
        };
        const result = createTermSchema.safeParse(input);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('terms with negative totalCost should be rejected', () => {
    fc.assert(
      fc.property(validTermInputArb, (term) => {
        const input = {
          ...term,
          totalCost: -(Math.random() * 1000 + 0.01),
          vehicleCoverage: { vehicleIds: ['v-1'] },
        };
        const result = createTermSchema.safeParse(input);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('terms with zero totalCost should be accepted', () => {
    fc.assert(
      fc.property(validTermInputArb, (term) => {
        const input = {
          ...term,
          totalCost: 0,
          vehicleCoverage: { vehicleIds: ['v-1'] },
        };
        const result = createTermSchema.safeParse(input);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test('terms without vehicleCoverage should be rejected', () => {
    fc.assert(
      fc.property(validTermInputArb, (term) => {
        const result = createTermSchema.safeParse(term);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

const rejectedMimeTypeArb = fc
  .tuple(fc.stringMatching(/^[a-z]{1,20}$/), fc.stringMatching(/^[a-z0-9.+-]{1,30}$/))
  .map(([type, subtype]) => `${type}/${subtype}`)
  .filter((mime) => !ACCEPTED_MIME_TYPES.includes(mime as (typeof ACCEPTED_MIME_TYPES)[number]));

describe('document MIME type validation', () => {
  test('accepted MIME types (jpeg, png, webp, pdf) are included in ALLOWED_MIME_TYPES', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ACCEPTED_MIME_TYPES), (mimeType) => {
        expect(ALLOWED_MIME_TYPES).toContain(mimeType);
      }),
      { numRuns: 100 }
    );
  });

  test('random non-accepted MIME types are not in ALLOWED_MIME_TYPES', () => {
    fc.assert(
      fc.property(rejectedMimeTypeArb, (mimeType) => {
        expect(ALLOWED_MIME_TYPES).not.toContain(mimeType);
      }),
      { numRuns: 100 }
    );
  });

  test('ALLOWED_MIME_TYPES contains exactly jpeg, png, webp, and pdf', () => {
    expect(ALLOWED_MIME_TYPES).toHaveLength(4);
    for (const mime of ACCEPTED_MIME_TYPES) {
      expect(ALLOWED_MIME_TYPES).toContain(mime);
    }
  });
});

describe('updateTermSchema date-order refine', () => {
  const T1 = '2024-01-01T00:00:00.000Z';
  const T2 = '2024-06-01T00:00:00.000Z';

  test('both dates with end > start are accepted', () => {
    expect(updateTermSchema.safeParse({ startDate: T1, endDate: T2 }).success).toBe(true);
  });

  test('both dates inverted or equal are rejected', () => {
    expect(updateTermSchema.safeParse({ startDate: T2, endDate: T1 }).success).toBe(false);
    expect(updateTermSchema.safeParse({ startDate: T1, endDate: T1 }).success).toBe(false);
  });

  test('a single date skips the order check', () => {
    expect(updateTermSchema.safeParse({ startDate: T2 }).success).toBe(true);
    expect(updateTermSchema.safeParse({ endDate: T1 }).success).toBe(true);
    expect(updateTermSchema.safeParse({ policyNumber: 'POL-9' }).success).toBe(true);
  });
});
