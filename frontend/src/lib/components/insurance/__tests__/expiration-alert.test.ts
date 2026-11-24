import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

const ExpirationAlert = (await import('../ExpirationAlert.svelte')).default;

const NOW = new Date(2026, 2, 20, 15, 0, 0);

function localDay(daysFromToday: number, hour = 12, minute = 0): Date {
	return new Date(2026, 2, 20 + daysFromToday, hour, minute, 0);
}

function badgeForEnd(end: string): HTMLElement | null {
	const { container } = render(ExpirationAlert, { props: { latestTermEnd: end } });
	return container.querySelector('[data-slot="badge"]');
}

function badgeFor(daysFromToday: number, hour = 12): HTMLElement | null {
	return badgeForEnd(localDay(daysFromToday, hour).toISOString());
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('ExpirationAlert thresholds', () => {
	test('a term that ended yesterday shows an Expired badge in destructive colours', () => {
		const badge = badgeFor(-1);
		expect(badge).toHaveTextContent('Expired');
		expect(badge).toHaveClass('text-destructive', 'border-destructive');
	});

	test('a term that ended late yesterday evening is expired, not due today', () => {
		expect(badgeFor(-1, 23)).toHaveTextContent('Expired');
	});

	test('a term ending later today reads "Expires today" and is urgent', () => {
		const badge = badgeFor(0, 18);
		expect(badge).toHaveTextContent('Expires today');
		expect(badge).toHaveClass('text-destructive');
	});

	test('a term whose end time already passed today still reads "Expires today"', () => {
		expect(badgeFor(0, 9)).toHaveTextContent('Expires today');
	});

	test('a term ending just before midnight tonight is still today', () => {
		expect(badgeForEnd(localDay(0, 23, 59).toISOString())).toHaveTextContent('Expires today');
	});

	test('a term ending just after midnight reads "Expires tomorrow" and is urgent', () => {
		const badge = badgeForEnd(localDay(1, 0, 1).toISOString());
		expect(badge).toHaveTextContent('Expires tomorrow');
		expect(badge).toHaveClass('text-destructive');
	});

	test('a term ending tomorrow evening reads "Expires tomorrow"', () => {
		expect(badgeFor(1, 20)).toHaveTextContent('Expires tomorrow');
	});

	test('seven days left is still urgent', () => {
		const badge = badgeFor(7);
		expect(badge).toHaveTextContent('7 days left');
		expect(badge).toHaveClass('text-destructive', 'border-destructive');
	});

	test('eight days left switches to the warning colour', () => {
		const badge = badgeFor(8);
		expect(badge).toHaveTextContent('8 days left');
		expect(badge).toHaveClass('text-warning', 'border-warning');
		expect(badge).not.toHaveClass('text-destructive');
	});

	test('thirty days left is the last day the warning shows', () => {
		expect(badgeFor(30)).toHaveTextContent('30 days left');
	});

	test('more than thirty days left renders no badge', () => {
		expect(badgeFor(31)).toBeNull();
	});

	test('a date-only end string counts as that calendar day in local time', () => {
		expect(badgeForEnd('2026-03-25')).toHaveTextContent('5 days left');
		cleanup();
		expect(badgeForEnd('2026-03-20')).toHaveTextContent('Expires today');
		cleanup();
		expect(badgeForEnd('2026-03-19')).toHaveTextContent('Expired');
	});

	test('counts calendar days across a month boundary', () => {
		vi.setSystemTime(new Date(2026, 0, 31, 22, 0, 0));
		expect(badgeForEnd(new Date(2026, 1, 1, 6, 0, 0).toISOString())).toHaveTextContent(
			'Expires tomorrow'
		);
	});
});
