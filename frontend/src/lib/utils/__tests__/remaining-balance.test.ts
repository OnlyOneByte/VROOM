import { describe, expect, test } from 'vitest';
import { calculatePayoffDate, remainingBalance } from '#lib/utils/financing-calculations.ts';
import { makeLoan } from '#lib/components/financing/__tests__/financing-fixtures';

describe('remainingBalance', () => {
	test('uses the computed balance when the backend sent one', () => {
		expect(remainingBalance(makeLoan({ computedBalance: 15_000 }))).toBe(15_000);
		expect(remainingBalance(makeLoan({ computedBalance: 0 }))).toBe(0);
	});

	test('falls back to the original amount when the balance is unknown', () => {
		expect(remainingBalance(makeLoan({ computedBalance: undefined }))).toBe(20_000);
	});

	test('an unknown balance is not reported as paid off today', () => {
		const payoff = calculatePayoffDate(makeLoan({ computedBalance: undefined }));
		const monthsAway =
			(payoff.getFullYear() - new Date().getFullYear()) * 12 +
			(payoff.getMonth() - new Date().getMonth());
		expect(monthsAway).toBeGreaterThan(12);
	});
});
