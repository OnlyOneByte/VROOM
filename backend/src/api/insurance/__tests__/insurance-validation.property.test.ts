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
import { policyTermSchema } from '../validation';
import {
  termWithNegativeCoverageLimitArb,
  termWithNegativeDeductibleArb,
  termWithNegativeMonthlyCostArb,
  termWithNegativeTotalCostArb,
  termWithReversedDatesArb,
  termWithSameDatesArb,
  termWithZeroCoverageLimitArb,
  termWithZeroDeductibleArb,
  termWithZeroMonthlyCostArb,
  termWithZeroTotalCostArb,
  validTermArb,
} from './insurance-test-generators';

// Feature: insurance-management, Property 4: Term field validation

describe('Property 4: Term field validation', () => {
  // -----------------------------------------------------------------------
  // 1. Valid terms should parse successfully
  // -----------------------------------------------------------------------
  test('valid terms with all constraints satisfied should parse successfully', () => {
    fc.assert(
      fc.property(validTermArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 2. Terms with startDate >= endDate (same date) should be rejected
  // -----------------------------------------------------------------------
  test('terms with startDate equal to endDate should be rejected', () => {
    fc.assert(
      fc.property(termWithSameDatesArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 3. Terms with startDate > endDate (reversed) should be rejected
  // -----------------------------------------------------------------------
  test('terms with startDate after endDate should be rejected', () => {
    fc.assert(
      fc.property(termWithReversedDatesArb, (term) => {
        // Only test when dates are actually different after reversal
        if (term.startDate === term.endDate) return;
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 4. Terms with negative deductibleAmount should be rejected
  // -----------------------------------------------------------------------
  test('terms with negative deductibleAmount should be rejected', () => {
    fc.assert(
      fc.property(termWithNegativeDeductibleArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 5. Terms with zero deductibleAmount should be rejected (must be positive)
  // -----------------------------------------------------------------------
  test('terms with zero deductibleAmount should be rejected', () => {
    fc.assert(
      fc.property(termWithZeroDeductibleArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 6. Terms with negative coverageLimit should be rejected
  // -----------------------------------------------------------------------
  test('terms with negative coverageLimit should be rejected', () => {
    fc.assert(
      fc.property(termWithNegativeCoverageLimitArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 7. Terms with zero coverageLimit should be rejected (must be positive)
  // -----------------------------------------------------------------------
  test('terms with zero coverageLimit should be rejected', () => {
    fc.assert(
      fc.property(termWithZeroCoverageLimitArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 8. Terms with negative totalCost should be rejected
  // -----------------------------------------------------------------------
  test('terms with negative totalCost should be rejected', () => {
    fc.assert(
      fc.property(termWithNegativeTotalCostArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 9. Terms with negative monthlyCost should be rejected
  // -----------------------------------------------------------------------
  test('terms with negative monthlyCost should be rejected', () => {
    fc.assert(
      fc.property(termWithNegativeMonthlyCostArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 10. Terms with zero totalCost should be accepted (non-negative)
  // -----------------------------------------------------------------------
  test('terms with zero totalCost should be accepted', () => {
    fc.assert(
      fc.property(termWithZeroTotalCostArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // -----------------------------------------------------------------------
  // 11. Terms with zero monthlyCost should be accepted (non-negative)
  // -----------------------------------------------------------------------
  test('terms with zero monthlyCost should be accepted', () => {
    fc.assert(
      fc.property(termWithZeroMonthlyCostArb, (term) => {
        const result = policyTermSchema.safeParse(term);
        expect(result.success).toBe(true);
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
