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
import { createTermSchema, updateTermSchema } from '../validation';
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

// ---------------------------------------------------------------------------
// updateTermSchema CONDITIONAL date-order refine (C443 guard). The PUT term schema is partial — both
// dates are independently optional — so its refine differs from createTermSchema: it enforces
// `endDate > startDate` ONLY when BOTH are present, and DELIBERATELY skips the check when exactly one
// date is sent (the "user corrects just the start date" partial-update path). The property suite above
// drives only createTermSchema; the only test touching updateTermSchema (partial-update-no-default-
// injection) sends no dates — so all three behavioral cells of THIS refine were unpinned, on a schema
// reachable via PUT /insurance/:id/terms/:termId (the repository writes whichever single date is sent
// with independent guards + no cross-check, so the schema is the ONLY order gate). Drives the REAL export.
// ---------------------------------------------------------------------------
describe('updateTermSchema date-order refine (partial-update, C443)', () => {
  const T1 = '2024-01-01T00:00:00.000Z';
  const T2 = '2024-06-01T00:00:00.000Z';

  test('both dates with end > start → accepted', () => {
    expect(updateTermSchema.safeParse({ startDate: T1, endDate: T2 }).success).toBe(true);
  });

  test('both dates INVERTED (end <= start) → rejected (the enforced cell)', () => {
    // end before start
    expect(updateTermSchema.safeParse({ startDate: T2, endDate: T1 }).success).toBe(false);
    // equal: the `>` (not `>=`) makes a zero-length term invalid too
    expect(updateTermSchema.safeParse({ startDate: T1, endDate: T1 }).success).toBe(false);
  });

  test('exactly ONE date present → accepted, the order check is skipped (the update-vs-create distinction)', () => {
    // A single-date partial update must pass the schema regardless of the stored counterpart — the
    // deliberate `return true` branch. NON-VACUOUS: tightening the refine to require both dates (or to
    // reject a lone date) flips these to false; dropping the `if (start && end)` guard so a lone date
    // hits the comparison would also reject one of them.
    expect(updateTermSchema.safeParse({ startDate: T2 }).success).toBe(true);
    expect(updateTermSchema.safeParse({ endDate: T1 }).success).toBe(true);
    // neither date (e.g. a policyNumber-only edit) → also accepted
    expect(updateTermSchema.safeParse({ policyNumber: 'POL-9' }).success).toBe(true);
  });
});
