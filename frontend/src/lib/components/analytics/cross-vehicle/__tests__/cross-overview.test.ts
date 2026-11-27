import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { EXPENSE_CATEGORIES } from '#lib/constants/expense-categories.ts';
import type { AnalyticsQueryResponse } from '#lib/types/index.ts';
import CrossVehicleOverview from '../CrossVehicleOverview.svelte';
import {
	MATRIX_CARS,
	carValues,
	categoryMatrix,
	crossHero,
	overviewRequests
} from '../cross-overview';

const perCar = (values: Record<string, number | null>): AnalyticsQueryResponse =>
	({
		series: Object.entries(values).map(([key, v]) => ({
			key,
			label: key.toUpperCase(),
			values: [v]
		}))
	}) as unknown as AnalyticsQueryResponse;

const byCategory = (
	rows: Partial<Record<(typeof EXPENSE_CATEGORIES)[number], Record<string, number>>>
) => EXPENSE_CATEGORIES.map(category => (rows[category] ? perCar(rows[category]) : null));

const running = carValues(perCar({ daily: 0.2, sparky: 0.09, weekend: 0.18 }));
const allIn = carValues(perCar({ daily: 0.58, sparky: 0.11, weekend: 0.09 }));
const spend = byCategory({
	fuel: { daily: 1350, sparky: 357, weekend: 549 },
	financial: { daily: 10149, weekend: 900 },
	maintenance: { daily: 934, sparky: 127, weekend: 249 }
});

describe('cross-vehicle overview figures', () => {
	test('the requests are a fixed set, whatever the number of cars', () => {
		const many = Array.from({ length: 12 }, (_, i) => `car-${i}`);
		const requests = overviewRequests({ startDate: 1, endDate: 2 }, many);
		expect(requests.categories).toHaveLength(EXPENSE_CATEGORIES.length);
		expect(requests.running).toMatchObject({
			metric: 'costPerDistance',
			include: 'running',
			start: 1
		});
		expect(requests.allIn).toMatchObject({ metric: 'costPerDistance', include: 'all' });
		expect(requests.allIn).not.toHaveProperty('start');
	});

	test('the hero names the cheapest car to run and the costliest all in, with its main cost', () => {
		expect(crossHero(running, allIn, spend, new Set())).toEqual({
			cheapest: 'SPARKY',
			costliest: 'DAILY',
			reason: 'loan and insurance payments'
		});
	});

	test("a car whose financials aren't shared never gets a loan reason or loan amounts", () => {
		const hidden = new Set(['daily']);
		const hero = crossHero(running, allIn, spend, hidden);
		expect(hero?.reason).not.toBe('loan and insurance payments');
		const matrix = categoryMatrix(spend, hidden);
		const financial = matrix.rows.find(r => r.category === 'financial');
		const daily = matrix.cars.findIndex(c => c.vehicleId === 'daily');
		expect(financial?.amounts[daily]).toBeNull();
		expect(matrix.cars.find(c => c.vehicleId === 'daily')?.total).toBe(1350 + 934);
	});

	test('the table keeps the five costliest cars and counts the rest', () => {
		const cars = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`c${i}`, 100 + i]));
		const matrix = categoryMatrix(byCategory({ fuel: cars }), new Set());
		expect(matrix.cars).toHaveLength(MATRIX_CARS);
		expect(matrix.cars[0]?.vehicleId).toBe('c7');
		expect(matrix.more).toBe(3);
	});
});

describe('CrossVehicleOverview', () => {
	test('a hidden financial amount reads as not shared, never as a number', () => {
		const hidden = new Set(['daily']);
		render(CrossVehicleOverview, {
			hero: crossHero(running, allIn, spend, hidden),
			running,
			allIn,
			matrix: categoryMatrix(spend, hidden),
			rangeText: 'Last 30 days',
			distanceUnit: 'mi'
		});
		const table = screen.getByRole('table', { name: 'Where the money went, all time' });
		expect(table.textContent).toContain('Not shared with you');
		expect(table.textContent).not.toContain('$10,149');
		expect(screen.getByText(/costs the most/).textContent).not.toMatch(/loan/);
		expect(screen.getByRole('list', { name: 'Running cost per mi, last 30 days' })).toBeTruthy();
	});

	test('the hero says "per mile", and names one car once when it is both cheapest and costliest', () => {
		render(CrossVehicleOverview, {
			hero: { cheapest: 'Civic', costliest: 'Civic', reason: 'maintenance' },
			running,
			allIn,
			matrix: categoryMatrix(spend, new Set()),
			rangeText: 'Last 30 days',
			distanceUnit: 'mi'
		});
		const hero = screen.getByText(/costs the most/);
		expect(hero.textContent?.replace(/\s+/g, ' ')).toContain(
			'Civic is cheapest to run but costs the most per mile all in, mostly maintenance.'
		);
		expect(screen.getAllByRole('rowheader').length).toBeGreaterThan(0);
	});
});
