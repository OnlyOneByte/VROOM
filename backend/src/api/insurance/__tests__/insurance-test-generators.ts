/**
 * Shared fast-check generators for insurance property tests (v2 schema).
 *
 * Exports reusable arbitraries for flat term inputs, policy inputs,
 * and date generators matching the insurance_terms table structure.
 */

import fc from 'fast-check';
import { CONFIG } from '../../../config';

const ins = CONFIG.validation.insurance;

// ---------------------------------------------------------------------------
// Primitive generators
// ---------------------------------------------------------------------------

/** A date in the 2020–2030 range as a Date object. */
export const dateArb = fc
  .integer({ min: 1577836800000, max: 1893456000000 }) // 2020-01-01 to 2030-01-01 in ms
  .map((ms) => new Date(ms));

/** A positive number suitable for deductibleAmount or coverageLimit. */
export const positiveAmountArb = fc.double({
  min: 0.01,
  max: 999_999,
  noNaN: true,
  noDefaultInfinity: true,
});

/** A non-negative number suitable for totalCost or monthlyCost. */
export const nonNegativeAmountArb = fc.double({
  min: 0,
  max: 999_999,
  noNaN: true,
  noDefaultInfinity: true,
});

// ---------------------------------------------------------------------------
// Company name generator
// ---------------------------------------------------------------------------

export const companyNameArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,49}$/)
  .filter((s) => s.trim().length > 0)
  .map((s) => s.trim());

// ---------------------------------------------------------------------------
// Valid flat term input generator (v2 — matches CreateTermInput)
// ---------------------------------------------------------------------------

/**
 * Generates a valid CreateTermInput with startDate < endDate and
 * optional flat fields for policy/finance details.
 */
export const validTermInputArb = fc
  .record({
    startMs: fc.integer({ min: 1577836800000, max: 1861920000000 }), // 2020 to ~2029
    gapMs: fc.integer({ min: 86_400_000, max: 365 * 86_400_000 }), // 1 day to 1 year gap
    policyNumber: fc.option(fc.string({ maxLength: ins.policyNumberMaxLength }), {
      nil: undefined,
    }),
    coverageDescription: fc.option(fc.string({ maxLength: ins.coverageDescriptionMaxLength }), {
      nil: undefined,
    }),
    deductibleAmount: fc.option(positiveAmountArb, { nil: undefined }),
    coverageLimit: fc.option(positiveAmountArb, { nil: undefined }),
    agentName: fc.option(fc.string({ maxLength: ins.agentNameMaxLength }), { nil: undefined }),
    agentPhone: fc.option(fc.string({ maxLength: ins.agentPhoneMaxLength }), { nil: undefined }),
    agentEmail: fc.option(
      fc
        .tuple(
          fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
          fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
          fc.constantFrom('com', 'org', 'net', 'io')
        )
        .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)
        .filter((e) => e.length <= ins.agentEmailMaxLength),
      { nil: undefined }
    ),
    totalCost: fc.option(nonNegativeAmountArb, { nil: undefined }),
    monthlyCost: fc.option(nonNegativeAmountArb, { nil: undefined }),
    premiumFrequency: fc.option(fc.string({ maxLength: ins.premiumFrequencyMaxLength }), {
      nil: undefined,
    }),
    paymentAmount: fc.option(nonNegativeAmountArb, { nil: undefined }),
  })
  .map(({ startMs, gapMs, ...rest }) => ({
    startDate: new Date(startMs),
    endDate: new Date(startMs + gapMs),
    ...rest,
  }));

/**
 * Valid term input that always has a totalCost defined.
 */
export const validTermInputWithTotalCostArb = validTermInputArb.map((term) => ({
  ...term,
  totalCost: Math.round((Math.random() * 5000 + 100) * 100) / 100,
}));

/**
 * Valid term input that never has a totalCost.
 */
export const validTermInputWithoutTotalCostArb = validTermInputArb.map((term) => {
  const { totalCost: _, ...rest } = term;
  return rest;
});

// ---------------------------------------------------------------------------
// Valid policy input generator (for repository tests)
// ---------------------------------------------------------------------------

/**
 * Generates a valid CreatePolicyData-shaped object.
 * vehicleIds must be supplied externally (they depend on seeded DB state).
 */
export const validPolicyInputArb = (vehicleIds: string[]) =>
  fc
    .record({
      company: companyNameArb,
      terms: fc.array(validTermInputArb, { minLength: 1, maxLength: 5 }),
      notes: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
      isActive: fc.boolean(),
    })
    .map((input) => ({
      ...input,
      terms: input.terms.map((t) => ({
        ...t,
        vehicleCoverage: { vehicleIds },
      })),
    }));

// ---------------------------------------------------------------------------
// Legacy v1 generators (used by insurance-validation.property.test.ts)
// These will be removed when validation is rewritten for v2 flat term schema.
// ---------------------------------------------------------------------------

/** A simple non-empty string ID. */
export const termIdArb = fc
  .string({ minLength: 1, maxLength: 25 })
  .filter((s) => s.trim().length > 0);

/** Valid policyDetails — all fields optional, numeric fields positive when present. */
export const validPolicyDetailsArb = fc.record(
  {
    policyNumber: fc.string({ maxLength: ins.policyNumberMaxLength }),
    coverageDescription: fc.string({ maxLength: ins.coverageDescriptionMaxLength }),
    deductibleAmount: positiveAmountArb,
    coverageLimit: positiveAmountArb,
    agentName: fc.string({ maxLength: ins.agentNameMaxLength }),
    agentPhone: fc.string({ maxLength: ins.agentPhoneMaxLength }),
    agentEmail: fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
        fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
        fc.constantFrom('com', 'org', 'net', 'io')
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)
      .filter((e) => e.length <= ins.agentEmailMaxLength),
  },
  { requiredKeys: [] }
);

/** Valid financeDetails — all fields optional, numeric fields non-negative when present. */
export const validFinanceDetailsArb = fc.record(
  {
    totalCost: nonNegativeAmountArb,
    monthlyCost: nonNegativeAmountArb,
    premiumFrequency: fc.string({ maxLength: ins.premiumFrequencyMaxLength }),
    paymentAmount: nonNegativeAmountArb,
  },
  { requiredKeys: [] }
);

/** Legacy valid term (v1 shape with nested policyDetails/financeDetails). */
export const validTermArb = fc
  .record({
    id: termIdArb,
    startMs: fc.integer({ min: 1577836800000, max: 1861920000000 }),
    gapMs: fc.integer({ min: 86_400_000, max: 365 * 86_400_000 }),
    policyDetails: validPolicyDetailsArb,
    financeDetails: validFinanceDetailsArb,
  })
  .map(({ id, startMs, gapMs, policyDetails, financeDetails }) => ({
    id,
    startDate: new Date(startMs).toISOString().split('T')[0],
    endDate: new Date(startMs + gapMs).toISOString().split('T')[0],
    policyDetails,
    financeDetails,
  }));

/** Term where startDate >= endDate (same date). */
export const termWithSameDatesArb = validTermArb.map((term) => ({
  ...term,
  endDate: term.startDate,
}));

/** Term where startDate > endDate (reversed). */
export const termWithReversedDatesArb = validTermArb.map((term) => ({
  ...term,
  startDate: term.endDate,
  endDate: term.startDate,
}));

/** Term with negative deductibleAmount. */
export const termWithNegativeDeductibleArb = validTermArb.map((term) => ({
  ...term,
  policyDetails: {
    ...term.policyDetails,
    deductibleAmount: -(Math.random() * 1000 + 0.01),
  },
}));

/** Term with zero deductibleAmount (must be positive, so zero is invalid). */
export const termWithZeroDeductibleArb = validTermArb.map((term) => ({
  ...term,
  policyDetails: {
    ...term.policyDetails,
    deductibleAmount: 0,
  },
}));

/** Term with negative coverageLimit. */
export const termWithNegativeCoverageLimitArb = validTermArb.map((term) => ({
  ...term,
  policyDetails: {
    ...term.policyDetails,
    coverageLimit: -(Math.random() * 1000 + 0.01),
  },
}));

/** Term with zero coverageLimit (must be positive, so zero is invalid). */
export const termWithZeroCoverageLimitArb = validTermArb.map((term) => ({
  ...term,
  policyDetails: {
    ...term.policyDetails,
    coverageLimit: 0,
  },
}));

/** Term with negative totalCost. */
export const termWithNegativeTotalCostArb = validTermArb.map((term) => ({
  ...term,
  financeDetails: {
    ...term.financeDetails,
    totalCost: -(Math.random() * 1000 + 0.01),
  },
}));

/** Term with negative monthlyCost. */
export const termWithNegativeMonthlyCostArb = validTermArb.map((term) => ({
  ...term,
  financeDetails: {
    ...term.financeDetails,
    monthlyCost: -(Math.random() * 1000 + 0.01),
  },
}));

/** Term with zero totalCost (should be accepted — non-negative). */
export const termWithZeroTotalCostArb = validTermArb.map((term) => ({
  ...term,
  financeDetails: {
    ...term.financeDetails,
    totalCost: 0,
  },
}));

/** Term with zero monthlyCost (should be accepted — non-negative). */
export const termWithZeroMonthlyCostArb = validTermArb.map((term) => ({
  ...term,
  financeDetails: {
    ...term.financeDetails,
    monthlyCost: 0,
  },
}));

/** Valid term that always has financeDetails.totalCost defined. */
export const validTermWithTotalCostArb = validTermArb.map((term) => ({
  ...term,
  financeDetails: {
    ...term.financeDetails,
    totalCost: Math.round((Math.random() * 5000 + 100) * 100) / 100,
  },
}));

/** Valid term that never has financeDetails.totalCost. */
export const validTermWithoutTotalCostArb = validTermArb.map((term) => {
  const { totalCost: _, ...rest } = term.financeDetails;
  return { ...term, financeDetails: rest };
});
