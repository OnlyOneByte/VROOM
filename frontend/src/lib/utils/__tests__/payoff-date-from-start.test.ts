import { describe, expect, test } from 'vitest';
import { calculatePayoffDateFromStart } from '$lib/utils/financing-calculations';

function payoff(start: Date, n: number): Date {
	return calculatePayoffDateFromStart(start as unknown as string, n);
}

const HOST_ZONES = [
	'UTC',
	'America/Anchorage',
	'America/Chicago',
	'Asia/Kolkata',
	'Pacific/Auckland',
	'Pacific/Kiritimati'
];

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

function localParts(date: Date): number[] {
	return [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()];
}

function julyOffset(): number {
	return new Date(2024, 6, 1).getTimezoneOffset();
}

const HOST_TZ_AT_LOAD = process.env['TZ'];
const HOST_OFFSET_AT_LOAD = julyOffset();

describe('calculatePayoffDateFromStart — month-overflow clamp', () => {
	test('Jan 31 + 1 month clamps to the last day of Feb (non-leap → Feb 28)', () => {
		const d = payoff(new Date(2023, 0, 31), 1);
		expect(d.getFullYear()).toBe(2023);
		expect(d.getMonth()).toBe(1);
		expect(d.getDate()).toBe(28);
	});

	test('Jan 31 + 1 month in a LEAP year clamps to Feb 29', () => {
		const d = payoff(new Date(2024, 0, 31), 1);
		expect(d.getMonth()).toBe(1);
		expect(d.getDate()).toBe(29);
	});

	test('Aug 31 + 1 month clamps to Sep 30 (30-day target month)', () => {
		const d = payoff(new Date(2024, 7, 31), 1);
		expect(d.getMonth()).toBe(8);
		expect(d.getDate()).toBe(30);
	});

	test('May 31 + 1 month clamps to Jun 30', () => {
		const d = payoff(new Date(2024, 4, 31), 1);
		expect(d.getMonth()).toBe(5);
		expect(d.getDate()).toBe(30);
	});
});

describe('calculatePayoffDateFromStart — no clamp needed', () => {
	test('a mid-month start lands on the same day-of-month, N months later', () => {
		const d = payoff(new Date(2024, 2, 15), 5);
		expect(d.getFullYear()).toBe(2024);
		expect(d.getMonth()).toBe(7);
		expect(d.getDate()).toBe(15);
	});

	test('0 payments returns the same calendar date', () => {
		const d = payoff(new Date(2024, 5, 15), 0);
		expect(d.getFullYear()).toBe(2024);
		expect(d.getMonth()).toBe(5);
		expect(d.getDate()).toBe(15);
	});

	test('the 28th never overflows any month (no clamp, exact day preserved)', () => {
		const d = payoff(new Date(2024, 0, 28), 1);
		expect(d.getMonth()).toBe(1);
		expect(d.getDate()).toBe(28);
	});
});

describe('calculatePayoffDateFromStart — year rollover', () => {
	test('Mar 15 + 12 months advances exactly one year, same month/day', () => {
		const d = payoff(new Date(2024, 2, 15), 12);
		expect(d.getFullYear()).toBe(2025);
		expect(d.getMonth()).toBe(2);
		expect(d.getDate()).toBe(15);
	});

	test('Oct 15 + 6 months crosses into the next year', () => {
		const d = payoff(new Date(2024, 9, 15), 6);
		expect(d.getFullYear()).toBe(2025);
		expect(d.getMonth()).toBe(3);
		expect(d.getDate()).toBe(15);
	});

	test('Dec 31 + 2 months rolls the year AND clamps (→ Feb 28 next year)', () => {
		const d = payoff(new Date(2024, 11, 31), 2);
		expect(d.getFullYear()).toBe(2025);
		expect(d.getMonth()).toBe(1);
		expect(d.getDate()).toBe(28);
	});
});

describe('calculatePayoffDateFromStart — a date-only string is the LOCAL calendar day', () => {
	test('a 1st-of-month, 60-payment loan lands on the 1st of the intended month (not the prior one)', () => {
		const payoff = calculatePayoffDateFromStart('2024-03-01', 60);
		expect(payoff.getFullYear()).toBe(2029);
		expect(payoff.getMonth()).toBe(2);
		expect(payoff.getDate()).toBe(1);
	});

	test('a 1st-of-month, 36-payment loan rolls the year without slipping a month', () => {
		const payoff = calculatePayoffDateFromStart('2024-01-01', 36);
		expect(payoff.getFullYear()).toBe(2027);
		expect(payoff.getMonth()).toBe(0);
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
		expect(payoff.getMonth()).toBe(1);
		expect(payoff.getDate()).toBe(29);
	});

	test('undefined start falls back to now (returns a valid Date, not Invalid)', () => {
		const d = calculatePayoffDateFromStart(undefined, 12);
		expect(Number.isNaN(d.getTime())).toBe(false);
		expect(d.getTime()).toBeGreaterThan(Date.now() - 1000);
	});

	test('the parse anchors at NOON local, so no host offset can move the calendar day', () => {
		expect(calculatePayoffDateFromStart('2024-03-01', 0).getHours()).toBe(12);
		expect(calculatePayoffDateFromStart('2024-03-01', 60).getHours()).toBe(12);
		expect(calculatePayoffDateFromStart('2024-01-31', 1).getHours()).toBe(12);
	});
});

describe('calculatePayoffDateFromStart — the local calendar day holds at EVERY host offset', () => {
	test.each(HOST_ZONES)(
		'%s: a 1st-of-month, 60-payment loan previews the 1st of the intended month',
		zone => {
			expect(
				inTimeZone(zone, () => localParts(calculatePayoffDateFromStart('2024-03-01', 60)))
			).toEqual([2029, 2, 1, 12]);
		}
	);

	test.each(HOST_ZONES)('%s: a 1st-of-January start does not slip into the prior year', zone => {
		expect(
			inTimeZone(zone, () => localParts(calculatePayoffDateFromStart('2024-01-01', 36)))
		).toEqual([2027, 0, 1, 12]);
	});

	test.each(HOST_ZONES)('%s: the month-end clamp survives the parse', zone => {
		expect(
			inTimeZone(zone, () => localParts(calculatePayoffDateFromStart('2024-01-31', 1)))
		).toEqual([2024, 1, 29, 12]);
	});

	test('forcing a zone is effective AND undone, so no case leaks into the next', () => {
		expect(process.env['TZ']).toBe(HOST_TZ_AT_LOAD);
		expect(julyOffset()).toBe(HOST_OFFSET_AT_LOAD);
		expect(inTimeZone('Pacific/Kiritimati', julyOffset)).toBe(-840);
		expect(inTimeZone('America/Anchorage', julyOffset)).toBe(480);
		expect(julyOffset()).toBe(HOST_OFFSET_AT_LOAD);
	});
});
