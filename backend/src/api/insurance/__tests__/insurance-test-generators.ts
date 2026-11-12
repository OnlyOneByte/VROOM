import fc from 'fast-check';
import { CONFIG } from '../../../config';

const ins = CONFIG.validation.insurance;

const positiveAmountArb = fc.double({
  min: 0.01,
  max: 999_999,
  noNaN: true,
  noDefaultInfinity: true,
});

const nonNegativeAmountArb = fc.double({
  min: 0,
  max: 999_999,
  noNaN: true,
  noDefaultInfinity: true,
});

export const companyNameArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,49}$/)
  .filter((s) => s.trim().length > 0)
  .map((s) => s.trim());

export const validTermInputArb = fc
  .record({
    startMs: fc.integer({ min: 1577836800000, max: 1861920000000 }),
    gapMs: fc.integer({ min: 86_400_000, max: 365 * 86_400_000 }),
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
