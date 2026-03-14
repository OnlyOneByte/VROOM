/**
 * Property-Based Tests for Insurance Validation Schemas
 *
 * Property 4: Term field validation
 * For any term where startDate >= endDate, or deductibleAmount is present and <= 0,
 * or coverageLimit is present and <= 0, or totalCost is present and < 0, or
 * monthlyCost is present and < 0, the schema should reject the term.
 * Conversely, for any term where all present numeric fields satisfy their constraints
 * and startDate < endDate, the term should be accepted.
 *
 * **Validates: Requirements 1.7, 1.8, 1.9, 1.10, 1.11**
 *
 * Property 8: Document MIME type validation
 * System accepts jpeg/png/webp/pdf, rejects all other MIME types.
 *
 * **Validates: Requirements 2.3**
 */

import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { ALLOWED_MIME_TYPES } from '../../photos/photo-service';
import { createTermSchema } from '../validation';
import { validTermInputArb } from './insurance-test-generators';

// Feature: insurance-management, Property 19: Insurance validation accepts flat term fields

describe('Property 19: Insurance validation accepts flat term fields', () => {
  // -----------------------------------------------------------------------
  // 1. Valid flat terms should parse successfully
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // 2. Terms with startDate >= endDate should be rejected
  // -----------------------------------------------------------------------
  test('terms with startDate equal to endDate should be rejected', () => {
    fc.assert(
      fc.property(validTermInputArb, (term) => {
        const input = {
          ...term,
          endDate: term.startDate, // same date
          vehicleCoverage: { vehicleIds: ['v-1'] },
        };
        const result = createTermSchema.safeParse(input);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 3. Terms with negative deductibleAmount should be rejected
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // 4. Terms with negative totalCost should be rejected
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // 5. Terms with zero totalCost should be accepted (non-negative)
  // -----------------------------------------------------------------------
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

  // -----------------------------------------------------------------------
  // 6. Terms missing vehicleCoverage should be rejected
  // -----------------------------------------------------------------------
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

// Feature: insurance-management, Property 8: Document MIME type validation

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

/** Generator for MIME types that are NOT in the accepted list. */
const rejectedMimeTypeArb = fc
  .tuple(fc.stringMatching(/^[a-z]{1,20}$/), fc.stringMatching(/^[a-z0-9.+-]{1,30}$/))
  .map(([type, subtype]) => `${type}/${subtype}`)
  .filter((mime) => !ACCEPTED_MIME_TYPES.includes(mime as (typeof ACCEPTED_MIME_TYPES)[number]));

describe('Property 8: Document MIME type validation', () => {
  // -----------------------------------------------------------------------
  // 1. All accepted MIME types should be in ALLOWED_MIME_TYPES
  // -----------------------------------------------------------------------
  test('accepted MIME types (jpeg, png, webp, pdf) are included in ALLOWED_MIME_TYPES', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ACCEPTED_MIME_TYPES), (mimeType) => {
        expect(ALLOWED_MIME_TYPES).toContain(mimeType);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 2. Random non-accepted MIME types should be rejected
  // -----------------------------------------------------------------------
  test('random non-accepted MIME types are not in ALLOWED_MIME_TYPES', () => {
    fc.assert(
      fc.property(rejectedMimeTypeArb, (mimeType) => {
        expect(ALLOWED_MIME_TYPES).not.toContain(mimeType);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 3. ALLOWED_MIME_TYPES contains exactly the 4 accepted types
  // -----------------------------------------------------------------------
  test('ALLOWED_MIME_TYPES contains exactly jpeg, png, webp, and pdf', () => {
    expect(ALLOWED_MIME_TYPES).toHaveLength(4);
    for (const mime of ACCEPTED_MIME_TYPES) {
      expect(ALLOWED_MIME_TYPES).toContain(mime);
    }
  });
});
