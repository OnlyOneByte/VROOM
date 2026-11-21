import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

const ExpirationAlert = (await import('../ExpirationAlert.svelte')).default;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-03-20T12:00:00.000Z');

function endInDays(days: number): string {
	return new Date(NOW.getTime() + days * DAY_MS).toISOString();
}

function badgeFor(days: number): HTMLElement | null {
	const { container } = render(ExpirationAlert, { props: { latestTermEnd: endInDays(days) } });
	return container.querySelector('[data-slot="badge"]');
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

	test('a term ending exactly now counts as expired', () => {
		expect(badgeFor(0)).toHaveTextContent('Expired');
	});

	test('a term ending in one day reads "Expires tomorrow" and is urgent', () => {
		const badge = badgeFor(1);
		expect(badge).toHaveTextContent('Expires tomorrow');
		expect(badge).toHaveClass('text-destructive');
	});

	test('a term ending part-way through tomorrow rounds up to one day', () => {
		expect(badgeFor(0.25)).toHaveTextContent('Expires tomorrow');
	});

	test('seven days left is still urgent', () => {
		const badge = badgeFor(7);
		expect(badge).toHaveTextContent('7 days left');
		expect(badge).toHaveClass('text-destructive', 'border-destructive');
	});

	test('eight days left switches to the warning colour', () => {
		const badge = badgeFor(8);
		expect(badge).toHaveTextContent('8 days left');
		expect(badge).toHaveClass('text-chart-5', 'border-chart-5');
		expect(badge).not.toHaveClass('text-destructive');
	});

	test('thirty days left is the last day the warning shows', () => {
		expect(badgeFor(30)).toHaveTextContent('30 days left');
	});

	test('more than thirty days left renders no badge', () => {
		expect(badgeFor(31)).toBeNull();
	});

	test('a date-only end string is evaluated against the current clock', () => {
		vi.setSystemTime(new Date('2026-03-20T00:00:00.000Z'));
		const { container } = render(ExpirationAlert, { props: { latestTermEnd: '2026-03-25' } });
		expect(container.querySelector('[data-slot="badge"]')).toHaveTextContent('5 days left');
	});
});
