/**
 * Tests for calculatePayoffDateFromStart() — the payoff date the vehicle form's amortization
 * preview renders (FinancingFormSection shows it as month + year only, so a one-day slip is a
 * visibly WRONG MONTH). The function is two composed steps, and both break silently:
 *
 * 1. PARSE. A raw `<input type="date">` value ('YYYY-MM-DD') is read as that LOCAL calendar day
 *    anchored at NOON local, by delegating to `dateOnlyToISO` — the anchor every form save
 *    persists date-only values at. A plain `new Date('2024-03-01')` would be midnight UTC, i.e.
 *    the PREVIOUS local day at every negative offset. Any other input (a full ISO instant, or a
 *    Date object) goes to `new Date(value)` unchanged.
 * 2. ADD MONTHS, CLAMPED. `addMonthsClamped` copies the parsed date and `setMonth(getMonth() + n)`s
 *    it; bare `setMonth` rolls a day past the target month's length into the FOLLOWING month
 *    (Jan 31 + 1mo → Mar 2/3, since Feb has no 31st), so when the day-of-month comes back changed
 *    it `setDate(0)`s to the last day of the INTENDED month. The helper is shared with the
 *    payment/lease-end projections, so the clamp cannot drift between them.
 *
 * Step 1 is INVISIBLE at offset 0 — midnight UTC and noon local name the same calendar day there,
 * and CI runs at UTC — so pinning the local day in one zone would guard nothing in the zone that
 * actually runs. Two assertions below therefore fail at offset 0 as well: the noon anchor itself
 * (`getHours() === 12`, which holds in every zone because noon ± any real offset never crosses
 * local midnight), and a zone matrix that forces the process timezone around each call so the
 * negative-offset day slip is reproduced regardless of where the suite runs.
 */

import { describe, expect, test } from 'vitest';
import { calculatePayoffDateFromStart } from '$lib/utils/financing-calculations';

/**
 * Call with a Date (unambiguous local fields): a Date doesn't match the date-only pattern, so it
 * takes the `new Date(value)` branch, which copies it. The cast documents that deliberate abuse of
 * the `string | undefined` signature.
 */
function payoff(start: Date, n: number): Date {
	return calculatePayoffDateFromStart(start as unknown as string, n);
}

/**
 * Host zones the parse must survive: UTC itself (what CI's ubuntu runners sit at, and the one
 * offset where the old midnight-UTC parse looked correct), two negative offsets where that parse
 * lands on the PREVIOUS day, a half-hour offset (+5:30), and the far-eastern extremes (+12/+13
 * and +14).
 */
const HOST_ZONES = [
	'UTC',
	'America/Anchorage',
	'America/Chicago',
	'Asia/Kolkata',
	'Pacific/Auckland',
	'Pacific/Kiritimati'
];

/**
 * Run `body` with the process timezone forced to `timeZone`, then restore the host zone. Node
 * applies a `process.env.TZ` write to every later Date operation, which is the only way a
 * single-zone test run can observe an offset it isn't running at. `body` must read the local date
 * FIELDS it asserts on (getFullYear/getMonth/getDate/getHours resolve against the zone in effect
 * when they are CALLED, not when the Date was built), so these cases return plain numbers.
 */
function inTimeZone<T>(timeZone: string, body: () => T): T {
	const hostZone = process.env['TZ'];
	process.env['TZ'] = timeZone;
	try {
		return body();
	} finally {
		if (hostZone === undefined) {
			delete process.env['TZ'];
		} else {
			process.env['TZ'] = hostZone;
		}
	}
}

/** [year, month, day-of-month, hour-of-day] in the zone in effect at call time. */
function localParts(date: Date): number[] {
	return [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()];
}

/** Minutes west of UTC for a fixed summer date — a cheap fingerprint of the zone in effect. */
function julyOffset(): number {
	return new Date(2024, 6, 1).getTimezoneOffset();
}

// Captured at module load, before any case has forced a zone, so the leak check at the bottom of
// this file can tell "restored" from "never touched".
const HOST_TZ_AT_LOAD = process.env['TZ'];
const HOST_OFFSET_AT_LOAD = julyOffset();

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
		// setMonth(11 + 2) rolls into Feb of the NEXT year, where day 31 overflows (Feb has 28) →
		// clamp. The year rollover and the clamp compose.
		const d = payoff(new Date(2024, 11, 31), 2);
		expect(d.getFullYear()).toBe(2025);
		expect(d.getMonth()).toBe(1); // February
		expect(d.getDate()).toBe(28);
	});
});

describe('calculatePayoffDateFromStart — a date-only string is the LOCAL calendar day', () => {
	// This is the ONE financing helper a raw `<input type="date">` value reaches: VehicleForm hands it
	// `financingForm.startDate` ('YYYY-MM-DD') straight from the binding. These cases run at the host
	// zone; the zone matrix below re-runs the same property at offsets the host does not have.
	test('a 1st-of-month, 60-payment loan lands on the 1st of the intended month (not the prior one)', () => {
		const payoff = calculatePayoffDateFromStart('2024-03-01', 60);
		expect(payoff.getFullYear()).toBe(2029);
		expect(payoff.getMonth()).toBe(2); // March — NOT February
		expect(payoff.getDate()).toBe(1);
	});

	test('a 1st-of-month, 36-payment loan rolls the year without slipping a month', () => {
		const payoff = calculatePayoffDateFromStart('2024-01-01', 36);
		expect(payoff.getFullYear()).toBe(2027);
		expect(payoff.getMonth()).toBe(0); // January — NOT December 2026
		expect(payoff.getDate()).toBe(1);
	});

	test('a mid-month start keeps its exact day-of-month', () => {
		const jan = calculatePayoffDateFromStart('2024-01-15', 60);
		expect([jan.getFullYear(), jan.getMonth(), jan.getDate()]).toEqual([2029, 0, 15]);
		const mar = calculatePayoffDateFromStart('2024-03-15', 60);
		expect([mar.getFullYear(), mar.getMonth(), mar.getDate()]).toEqual([2029, 2, 15]);
	});

	test('the month-end clamp still applies to a date-only start (Jan 31 + 1 → Feb 29 in 2024)', () => {
		const payoff = calculatePayoffDateFromStart('2024-01-31', 1);
		expect(payoff.getFullYear()).toBe(2024);
		expect(payoff.getMonth()).toBe(1); // February
		expect(payoff.getDate()).toBe(29); // clamped, leap year
	});

	test('undefined start falls back to now (returns a valid Date, not Invalid)', () => {
		const d = calculatePayoffDateFromStart(undefined, 12);
		expect(Number.isNaN(d.getTime())).toBe(false);
		// 12 months from "now" is next year or later — strictly in the future of construction.
		expect(d.getTime()).toBeGreaterThan(Date.now() - 1000);
	});

	test('the parse anchors at NOON local, so no host offset can move the calendar day', () => {
		// The one difference between the two parses that is observable AT EVERY OFFSET, UTC included:
		// `new Date('2024-03-01')` is midnight UTC (hour 0 local at offset 0, and whatever the offset
		// is elsewhere), while the noon-local anchor dateOnlyToISO writes is hour 12 everywhere —
		// noon ± any real offset (±14h) stays inside the same local day. The clamped month add is
		// local-field arithmetic, so it carries the anchor through untouched.
		expect(calculatePayoffDateFromStart('2024-03-01', 0).getHours()).toBe(12);
		expect(calculatePayoffDateFromStart('2024-03-01', 60).getHours()).toBe(12);
		expect(calculatePayoffDateFromStart('2024-01-31', 1).getHours()).toBe(12);
	});
});

describe('calculatePayoffDateFromStart — the local calendar day holds at EVERY host offset', () => {
	// The payoff preview must name the month the user's contract starts in no matter where the
	// browser (or the test runner) sits. A UTC-midnight parse is the PREVIOUS local day at every
	// negative offset, which these reproduce from any host zone by forcing the process timezone.
	test.each(HOST_ZONES)(
		'%s: a 1st-of-month, 60-payment loan previews the 1st of the intended month',
		zone => {
			expect(
				inTimeZone(zone, () => localParts(calculatePayoffDateFromStart('2024-03-01', 60)))
			).toEqual([2029, 2, 1, 12]); // March 1 2029, noon local — NOT Feb 28 2029
		}
	);

	test.each(HOST_ZONES)('%s: a 1st-of-January start does not slip into the prior year', zone => {
		expect(
			inTimeZone(zone, () => localParts(calculatePayoffDateFromStart('2024-01-01', 36)))
		).toEqual([2027, 0, 1, 12]); // January 1 2027 — NOT Dec 31 2026
	});

	test.each(HOST_ZONES)('%s: the month-end clamp survives the parse', zone => {
		expect(
			inTimeZone(zone, () => localParts(calculatePayoffDateFromStart('2024-01-31', 1)))
		).toEqual([2024, 1, 29, 12]); // Feb 29 2024 (leap) — not Mar 2, not Feb 28
	});

	test('forcing a zone is effective AND undone, so no case leaks into the next', () => {
		// Compared against the module-load snapshot, not against the zone in effect right now, so a
		// leak from the cases ABOVE is caught too (without the restore, the last matrix zone would
		// still be in force here).
		expect(process.env['TZ']).toBe(HOST_TZ_AT_LOAD);
		expect(julyOffset()).toBe(HOST_OFFSET_AT_LOAD);
		// Absolute offsets, so this proves the forcing actually bites instead of comparing a zone to
		// itself: Kiritimati is UTC+14 year-round, Anchorage UTC-8 in July.
		expect(inTimeZone('Pacific/Kiritimati', julyOffset)).toBe(-840);
		expect(inTimeZone('America/Anchorage', julyOffset)).toBe(480);
		expect(julyOffset()).toBe(HOST_OFFSET_AT_LOAD);
	});
});
