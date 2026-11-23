import { describe, expect, test } from 'vitest';
import {
	carsLabel,
	filterDateRange,
	isDefaultFilters,
	parseAnalyticsFilters,
	previousPeriodLabel,
	rangeLabel,
	writeAnalyticsFilters
} from '../analytics-filters';

const params = (query: string) => new URLSearchParams(query);
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);
const NOW = new Date(2026, 10, 23, 15, 30);

describe('analytics filters in the URL', () => {
	test('no params means the last 12 months and every car', () => {
		const filters = parseAnalyticsFilters(params(''));
		expect(filters).toEqual({ range: '12m', cars: [] });
		expect(isDefaultFilters(filters)).toBe(true);
	});

	test('a preset and a car list round-trip through the URL', () => {
		const filters = parseAnalyticsFilters(params('range=24m&cars=a,%20b,,c'));
		expect(filters).toEqual({ range: '24m', cars: ['a', 'b', 'c'] });
		const url = writeAnalyticsFilters(new URL('https://x.test/analytics?tab=1&cars=z'), filters);
		expect(url.search).toBe('?tab=1&range=24m&cars=a%2Cb%2Cc');
		expect(parseAnalyticsFilters(url.searchParams)).toEqual(filters);
	});

	test('the default range is left out of the URL', () => {
		const url = writeAnalyticsFilters(new URL('https://x.test/analytics?range=3m&cars=a'), {
			range: '12m',
			cars: []
		});
		expect(url.search).toBe('');
	});

	test('a custom range keeps its dates and rejects bad or reversed ones', () => {
		const custom = parseAnalyticsFilters(params('range=custom&from=2025-01-01&to=2025-03-31'));
		expect(custom).toEqual({ range: 'custom', from: '2025-01-01', to: '2025-03-31', cars: [] });
		expect(
			writeAnalyticsFilters(new URL('https://x.test/analytics'), custom).searchParams.get('from')
		).toBe('2025-01-01');
		for (const bad of [
			'range=custom&from=2025-03-31&to=2025-01-01',
			'range=custom&from=2025-02-30&to=2025-03-01',
			'range=custom&from=yesterday&to=2025-03-01',
			'range=custom',
			'range=forever'
		]) {
			expect(parseAnalyticsFilters(params(bad)).range, bad).toBe('12m');
		}
	});

	test('presets turn into local-midnight epoch seconds ending tomorrow', () => {
		const tomorrow = seconds(new Date(2026, 10, 24));
		expect(filterDateRange({ range: '3m', cars: [] }, NOW)).toEqual({
			startDate: seconds(new Date(2026, 7, 23)),
			endDate: tomorrow,
			ytdStart: seconds(new Date(2026, 0, 1))
		});
		expect(filterDateRange({ range: '24m', cars: [] }, NOW).startDate).toBe(
			seconds(new Date(2024, 10, 23))
		);
		expect(filterDateRange({ range: 'ytd', cars: [] }, NOW).startDate).toBe(
			seconds(new Date(2026, 0, 1))
		);
		expect(filterDateRange({ range: 'all', cars: [] }, NOW).startDate).toBe(1);
		expect(
			filterDateRange({ range: 'custom', from: '2025-01-01', to: '2025-01-31', cars: [] }, NOW)
		).toMatchObject({
			startDate: seconds(new Date(2025, 0, 1)),
			endDate: seconds(new Date(2025, 1, 1))
		});
		expect(filterDateRange({ range: 'custom', cars: [] }, NOW).startDate).toBe(
			seconds(new Date(2025, 10, 23))
		);
	});

	test('labels name the range and the cars', () => {
		const day = (d: Date) => d.toISOString().slice(0, 10);
		expect(rangeLabel({ range: 'ytd', cars: [] }, day)).toBe('Year to date');
		expect(
			rangeLabel({ range: 'custom', from: '2025-01-01', to: '2025-01-31', cars: [] }, () => 'D')
		).toBe('D – D');
		const names = new Map([
			['a', '2019 Honda Civic'],
			['b', '2022 Toyota RAV4']
		]);
		expect(carsLabel([], names)).toBe('All cars');
		expect(carsLabel(['a', 'gone'], names)).toBe('2019 Honda Civic');
		expect(carsLabel(['a', 'b'], names)).toBe('2 cars');
		expect(carsLabel(['gone'], names)).toBe('All cars');
	});

	test('the previous-period wording follows the range', () => {
		expect(previousPeriodLabel({ range: '12m', cars: [] })).toBe('vs the 12 months before');
		expect(previousPeriodLabel({ range: '3m', cars: [] })).toBe('vs the 3 months before');
		expect(previousPeriodLabel({ range: 'ytd', cars: [] })).toBe(
			'vs the same length of time before'
		);
	});
});
