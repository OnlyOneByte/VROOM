// Pins FuelStatsTab's empty-data gate: any fillup or distance must show the full grid, otherwise one EmptyState. Source scan, since analytics has no component harness.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const CWD = process.cwd();
const SRC = readFileSync(`${CWD}/src/lib/components/analytics/fuel/FuelStatsTab.svelte`, 'utf8');

describe('FuelStatsTab keeps its empty-data four-state gate', () => {
	test('derives hasFuelData (the empty-vs-grid decision)', () => {
		expect(SRC).toMatch(/hasFuelData\s*=\s*\$derived/);
	});

	test('hasFuelData stays CONSERVATIVE — any fillup year-bucket OR recorded distance shows the grid', () => {
		// The OR-of-three (never hide real data): currentYear fillups, previousYear fillups, or totalDistance.
		expect(SRC).toMatch(/fillups\.currentYear\s*>\s*0/);
		expect(SRC).toMatch(/fillups\.previousYear\s*>\s*0/);
		expect(SRC).toMatch(/distance\.totalDistance\s*>\s*0/);
	});

	test('gates the EmptyState on !hasFuelData (so empty data shows one empty state, not ~10 N/A cards)', () => {
		expect(SRC).toMatch(/!hasFuelData/);
		expect(SRC).toContain('No fuel data yet');
	});

	test('renders the full four-state set (loading / error+Retry / empty / data)', () => {
		expect(SRC).toContain('isLoading');
		expect(SRC).toMatch(/:else if error/);
		expect(SRC).toContain('EmptyState');
		expect(SRC).toContain('Retry');
	});
});
