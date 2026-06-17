/**
 * Tests for calculatePayoffDateFromStart() — the vehicle-form amortization-preview payoff date
 * (financing-calculations.ts:545; VehicleForm.svelte:296). Previously had ZERO coverage despite a
 * subtle month-overflow CLAMP: `new Date(year, startMonth + n, startDay)` rolls a day past the
 * target month's length into the FOLLOWING month (Jan 31 + 1mo → Mar 3, since Feb has no 31st), so
 * the function detects the rolled day (`getDate() !== start.getDate()`) and `setDate(0)`s back to the
 * last day of the intended month. That clamp is exactly the kind of date arithmetic a refactor
 * silently breaks (drop the guard → the preview shows a payoff date in the wrong month). These pin
 * the clamp + the year-rollover + the no-op paths.
 *
 * Inputs use Date OBJECTS (not date-only strings) so getFullYear/getMonth/getDate are read in the
 * SAME frame the function constructs them — host-timezone-independent assertions (the C103/C77 trap:
 * a 'YYYY-MM-DD' string parses as UTC midnight, which the local getters can shift a day). A separate
 * block exercises the real date-only-string call path with timezone-robust relative assertions.
 *
 * NOTE: the function takes `startDateStr: string | undefined`, but at runtime `new Date(x)` accepts a
 * Date too and returns it; passing a Date keeps the field math unambiguous. The cast documents that.
 */

import { describe, expect, test } from 'vitest';
import { calculatePayoffDateFromStart } from '$lib/utils/financing-calculations';

/** Call with a Date (unambiguous local fields) — the fn does `new Date(x)`, idempotent on a Date. */
function payoff(start: Date, n: number): Date {
	return calculatePayoffDateFromStart(start as unknown as string, n);
}

describe('calculatePayoffDateFromStart — month-overflow clamp', () => {
	test('Jan 31 + 1 month clamps to the last day of Feb (non-leap → Feb 28)', () => {
		const d = payoff(new Date(2023, 0, 31), 1);
		expect(d.getFullYear()).toBe(2023);
		expect(d.getMonth()).toBe(1); // February
		expect(d.getDate()).toBe(28); // clamped (NOT Mar 3)
	});

	test('Jan 31 + 1 month in a LEAP year clamps to Feb 29', () => {
		const d = payoff(new Date(2024, 0, 31), 1);
		expect(d.getMonth()).toBe(1);
		expect(d.getDate()).toBe(29);
	});

	test('Aug 31 + 1 month clamps to Sep 30 (30-day target month)', () => {
		const d = payoff(new Date(2024, 7, 31), 1);
		expect(d.getMonth()).toBe(8); // September
		expect(d.getDate()).toBe(30); // clamped (NOT Oct 1)
	});

	test('May 31 + 1 month clamps to Jun 30', () => {
		const d = payoff(new Date(2024, 4, 31), 1);
		expect(d.getMonth()).toBe(5); // June
		expect(d.getDate()).toBe(30);
	});
});

describe('calculatePayoffDateFromStart — no clamp needed', () => {
	test('a mid-month start lands on the same day-of-month, N months later', () => {
		const d = payoff(new Date(2024, 2, 15), 5); // Mar 15 + 5 → Aug 15
		expect(d.getFullYear()).toBe(2024);
		expect(d.getMonth()).toBe(7); // August
		expect(d.getDate()).toBe(15);
	});

	test('0 payments returns the same calendar date', () => {
		const d = payoff(new Date(2024, 5, 15), 0);
		expect(d.getFullYear()).toBe(2024);
		expect(d.getMonth()).toBe(5);
		expect(d.getDate()).toBe(15);
	});

	test('the 28th never overflows any month (no clamp, exact day preserved)', () => {
		const d = payoff(new Date(2024, 0, 28), 1); // Jan 28 + 1 → Feb 28
		expect(d.getMonth()).toBe(1);
		expect(d.getDate()).toBe(28);
	});
});

describe('calculatePayoffDateFromStart — year rollover', () => {
	test('Mar 15 + 12 months advances exactly one year, same month/day', () => {
		const d = payoff(new Date(2024, 2, 15), 12);
		expect(d.getFullYear()).toBe(2025);
		expect(d.getMonth()).toBe(2); // March
		expect(d.getDate()).toBe(15);
	});

	test('Oct 15 + 6 months crosses into the next year', () => {
		const d = payoff(new Date(2024, 9, 15), 6); // Oct 2024 + 6 → Apr 2025
		expect(d.getFullYear()).toBe(2025);
		expect(d.getMonth()).toBe(3); // April
		expect(d.getDate()).toBe(15);
	});

	test('Dec 31 + 2 months rolls the year AND clamps (→ Feb 28 next year)', () => {
		// targetMonth = 11 + 2 = 13 → the constructor rolls to Feb of the next year, day 31 →
		// overflows (Feb has 28) → clamp. Both behaviors compose.
		const d = payoff(new Date(2024, 11, 31), 2);
		expect(d.getFullYear()).toBe(2025);
		expect(d.getMonth()).toBe(1); // February
		expect(d.getDate()).toBe(28);
	});
});

describe('calculatePayoffDateFromStart — real date-only-string call path (host-robust)', () => {
	// VehicleForm passes a 'YYYY-MM-DD' string. A date-only string parses as UTC midnight, so the
	// exact local day can shift ±1 by host offset — assert only timezone-INVARIANT properties.
	test('a 60-payment loan payoff lands ~5 years out and strictly after the start', () => {
		const startStr = '2024-01-15';
		const d = calculatePayoffDateFromStart(startStr, 60);
		const start = new Date(startStr);
		expect(d.getTime()).toBeGreaterThan(start.getTime());
		// 60 months ≈ 5 years; allow the ±1-day/parse slop to never move the year off 2029.
		expect(d.getFullYear()).toBe(2029);
	});

	test('undefined start falls back to now (returns a valid Date, not Invalid)', () => {
		const d = calculatePayoffDateFromStart(undefined, 12);
		expect(Number.isNaN(d.getTime())).toBe(false);
		// 12 months from "now" is next year or later — strictly in the future of construction.
		expect(d.getTime()).toBeGreaterThan(Date.now() - 1000);
	});
});
