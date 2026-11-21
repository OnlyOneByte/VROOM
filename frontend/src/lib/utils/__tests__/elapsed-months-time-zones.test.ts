import { describe, expect, test } from 'vitest';
import { elapsedMonths } from '#lib/utils/financing-calculations.ts';

const HOST_ZONES = [
	'UTC',
	'America/Los_Angeles',
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

describe('elapsedMonths counts local calendar months in every time zone', () => {
	for (const zone of HOST_ZONES) {
		test(`${zone}: local-noon dates three months apart across a DST change are exactly 3`, () => {
			const months = inTimeZone(zone, () =>
				elapsedMonths(new Date(2025, 0, 15, 12), new Date(2025, 3, 15, 12))
			);
			expect(months).toBe(3);
		});

		test(`${zone}: local-noon dates across the spring change keep whole months whole`, () => {
			const months = inTimeZone(zone, () =>
				elapsedMonths(new Date(2025, 8, 1, 12), new Date(2025, 9, 1, 12))
			);
			expect(months).toBe(1);
		});
	}
});
