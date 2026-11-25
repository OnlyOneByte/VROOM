import { afterEach, describe, expect, test, vi } from 'vitest';
import { userTimeZone } from '../analytics-api.ts';

afterEach(() => vi.restoreAllMocks());

describe('userTimeZone', () => {
	test('reuses one formatter while the UTC offset stays the same', () => {
		const make = vi.spyOn(Intl, 'DateTimeFormat');
		const zone = userTimeZone();
		expect(userTimeZone()).toBe(zone);
		expect(userTimeZone()).toBe(zone);
		expect(make).toHaveBeenCalledTimes(1);
	});

	test('looks the zone up again when the UTC offset changes, as after travel or a clock change', () => {
		userTimeZone();
		vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-780);
		const make = vi
			.spyOn(Intl, 'DateTimeFormat')
			.mockImplementation(
				() => ({ resolvedOptions: () => ({ timeZone: 'Pacific/Auckland' }) }) as Intl.DateTimeFormat
			);
		expect(userTimeZone()).toBe('Pacific/Auckland');
		expect(make).toHaveBeenCalledTimes(1);
	});
});
