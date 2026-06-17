/**
 * Unit tests for getVehicleDisplayName — the vehicle label helper used across the expenses,
 * reminders, insurance, and dashboard surfaces (8 components + 4 routes).
 *
 * This pins the REAL exported helper. Before C364 the only "coverage" was VehicleManagement.test.ts,
 * which RE-IMPLEMENTS the function as a local arrow and tests that copy — never importing the real
 * export (the C229 coverage-theater anti-pattern: a test that reconstructs a module's logic locally
 * is not real coverage). So the load-bearing fallback was unguarded.
 *
 * The invariant that matters: the `!vehicle → 'Unknown Vehicle'` branch is REACHABLE — a split
 * expense, reminder, or insurance term can outlive the vehicle it references (the #88/#97 deleted-
 * vehicle family), and every consumer site relies on this helper to render a safe label instead of
 * dereferencing `.year`/`.make`/`.model` on null. A regression that drops or inverts the falsy guard
 * would crash those surfaces (or mislabel a real vehicle as "Unknown").
 */

import { describe, expect, test } from 'vitest';
import { getVehicleDisplayName } from '../vehicle-helpers';

describe('getVehicleDisplayName', () => {
	test('nickname wins when set (the user-chosen label)', () => {
		expect(
			getVehicleDisplayName({ year: 2021, make: 'Ford', model: 'F-150', nickname: 'Daily Driver' })
		).toBe('Daily Driver');
	});

	test('falls back to "year make model" when no nickname', () => {
		expect(getVehicleDisplayName({ year: 2021, make: 'Ford', model: 'F-150' })).toBe(
			'2021 Ford F-150'
		);
	});

	test('an empty-string nickname falls through to "year make model" (|| is falsy-checked)', () => {
		// nickname '' is falsy, so the OR picks the formatted name rather than rendering a blank label.
		expect(getVehicleDisplayName({ year: 2020, make: 'Toyota', model: 'Camry', nickname: '' })).toBe(
			'2020 Toyota Camry'
		);
	});

	// The load-bearing branch: a reference to a vehicle that no longer exists (deleted while a split
	// expense / reminder / insurance term still points at it — the #88/#97 surface).
	test('null vehicle → "Unknown Vehicle" (deleted-vehicle fallback, never dereferences null)', () => {
		expect(getVehicleDisplayName(null)).toBe('Unknown Vehicle');
	});

	test('undefined vehicle → "Unknown Vehicle" (transient/loading data)', () => {
		expect(getVehicleDisplayName(undefined)).toBe('Unknown Vehicle');
	});
});
