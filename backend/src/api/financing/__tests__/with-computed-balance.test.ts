/**
 * Unit tests for withComputedBalance (C243 arch dedup). The `{ ...financing, computedBalance,
 * eligibleForPayoff: isEligibleForPayoff(...) }` enrichment shape was hand-rolled at 3 route sites
 * (vehicles list + single GET, financing GET); this pure helper is now the single source of truth, so
 * pin its contract here: it spreads the financing object, attaches computedBalance verbatim, and
 * derives eligibleForPayoff from the PAYOFF_BALANCE_THRESHOLD boundary.
 */

import { describe, expect, test } from 'bun:test';
import { PAYOFF_BALANCE_THRESHOLD, withComputedBalance } from '../repository';

describe('withComputedBalance', () => {
  test('spreads the financing object and attaches the two derived fields', () => {
    const financing = {
      id: 'fin-1',
      vehicleId: 'v-1',
      originalAmount: 20000,
      financingType: 'loan',
    };
    const enriched = withComputedBalance(financing, 12000);

    // Original fields preserved verbatim.
    expect(enriched.id).toBe('fin-1');
    expect(enriched.vehicleId).toBe('v-1');
    expect(enriched.originalAmount).toBe(20000);
    expect(enriched.financingType).toBe('loan');
    // Derived fields attached.
    expect(enriched.computedBalance).toBe(12000);
    expect(enriched.eligibleForPayoff).toBe(false); // 12000 > threshold
  });

  test('eligibleForPayoff tracks the payoff threshold boundary', () => {
    const fin = { id: 'fin-2' };
    // At or below the threshold → eligible; just above → not.
    expect(withComputedBalance(fin, 0).eligibleForPayoff).toBe(true);
    expect(withComputedBalance(fin, PAYOFF_BALANCE_THRESHOLD).eligibleForPayoff).toBe(true);
    expect(withComputedBalance(fin, PAYOFF_BALANCE_THRESHOLD + 0.001).eligibleForPayoff).toBe(
      false
    );
  });

  test('does not mutate the input financing object', () => {
    const financing = { id: 'fin-3', originalAmount: 5000 };
    const enriched = withComputedBalance(financing, 100);
    expect(enriched).not.toBe(financing); // new object
    expect('computedBalance' in financing).toBe(false); // input untouched
  });
});
