import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { dateOnlyToISO, formatDate, toDateInputValue } from '#lib/utils/formatters.ts';
import { getDaysRemaining, hasTermEnded } from '#lib/utils/insurance.ts';
import { makeTerm } from './insurance-fixtures.ts';

const PolicyTermCard = (await import('../PolicyTermCard.svelte')).default;

const ORIGINAL_TZ = process.env['TZ'];

beforeAll(() => {
	process.env['TZ'] = 'Etc/GMT-12';
});

afterAll(() => {
	if (ORIGINAL_TZ === undefined) {
		delete process.env['TZ'];
	} else {
		process.env['TZ'] = ORIGINAL_TZ;
	}
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('insurance dates in a UTC+12 time zone', () => {
	test('the time zone pin is in effect', () => {
		expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-720);
	});

	test('a date saved by the forms reads back as the same calendar day', () => {
		const saved = dateOnlyToISO('2026-06-01');
		expect(toDateInputValue(saved)).toBe('2026-06-01');
		expect(formatDate(saved)).toBe('Jun 1, 2026');
	});

	test('an early-morning local time keeps its local day, not the earlier UTC day', () => {
		const earlyMorning = new Date(2026, 5, 1, 6, 0).toISOString();
		expect(earlyMorning.startsWith('2026-05-31')).toBe(true);
		expect(toDateInputValue(earlyMorning)).toBe('2026-06-01');
		expect(formatDate(earlyMorning)).toBe('Jun 1, 2026');
		expect(getDaysRemaining(earlyMorning, new Date(2026, 5, 1, 20, 0))).toBe(0);
	});

	test('a term stays current through its end date and ends the next local day', () => {
		const endDate = dateOnlyToISO('2026-06-01');
		expect(getDaysRemaining(endDate, new Date(2026, 5, 1, 23, 30))).toBe(0);
		expect(hasTermEnded({ endDate }, new Date(2026, 5, 1, 23, 30))).toBe(false);
		expect(hasTermEnded({ endDate }, new Date(2026, 5, 2, 0, 30))).toBe(true);
	});

	test('the term card shows the saved end date as the current term on its last day', () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 5, 1, 23, 30));
		render(PolicyTermCard, {
			props: {
				term: makeTerm({
					startDate: dateOnlyToISO('2025-06-01'),
					endDate: dateOnlyToISO('2026-06-01')
				}),
				isCurrent: true
			}
		});

		expect(screen.getByText('Current Term')).toBeInTheDocument();
		expect(screen.getByText('Jun 1, 2026')).toBeInTheDocument();
	});
});
