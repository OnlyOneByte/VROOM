import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import SplitConfigEditor from '../SplitConfigEditor.svelte';
import type { Vehicle } from '#lib/types/index.ts';

type SplitMethod = 'even' | 'absolute' | 'percentage';
interface Allocation {
	vehicleId: string;
	amount?: number;
	percentage?: number;
}

const CAMRY: Vehicle = {
	id: 'v1',
	year: 2020,
	make: 'Toyota',
	model: 'Camry',
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
};
const RAV4: Vehicle = { ...CAMRY, id: 'v2', model: 'RAV4', nickname: 'Hauler' };
const CIVIC: Vehicle = { ...CAMRY, id: 'v3', make: 'Honda', model: 'Civic' };

function renderEditor(
	splitMethod: SplitMethod,
	allocations: Allocation[] = [],
	vehicles: Vehicle[] = [CAMRY, RAV4, CIVIC],
	totalAmount = 100
) {
	const onMethodChange = vi.fn();
	const onAllocationsChange = vi.fn();
	const view = render(SplitConfigEditor, {
		vehicles,
		totalAmount,
		splitMethod,
		allocations,
		onMethodChange,
		onAllocationsChange
	});
	return { ...view, onMethodChange, onAllocationsChange };
}

function rowText(label: string): string {
	const span = screen.getByText(label);
	return span.parentElement?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('SplitConfigEditor: method switcher', () => {
	test.each<[string, SplitMethod]>([
		['Even', 'even'],
		['Fixed $', 'absolute'],
		['%', 'percentage']
	])('clicking %s requests the %s method', async (label, method) => {
		const { onMethodChange } = renderEditor('even');

		await fireEvent.click(screen.getByRole('button', { name: label }));

		expect(onMethodChange).toHaveBeenCalledWith(method);
	});

	test('without a method handler it is a read-only even preview', () => {
		render(SplitConfigEditor, {
			vehicles: [CAMRY, RAV4],
			totalAmount: 50,
			splitMethod: 'even',
			allocations: []
		});

		expect(screen.queryByRole('button')).toBeNull();
		expect(rowText('Hauler')).toBe('Hauler $25.00');
	});
});

describe('SplitConfigEditor: even split', () => {
	test('gives a single leftover cent to the first vehicle so shares add up to the total', () => {
		renderEditor('even');

		expect(rowText('2020 Toyota Camry')).toBe('2020 Toyota Camry $33.34');
		expect(rowText('Hauler')).toBe('Hauler $33.33');
		expect(rowText('2020 Honda Civic')).toBe('2020 Honda Civic $33.33');
		expect(rowText('Total')).toBe('Total $100.00');
	});

	test('gives one leftover cent each to the first vehicles, as the saved split does', () => {
		renderEditor('even', [], [CAMRY, RAV4, CIVIC], 10.01);

		expect(rowText('2020 Toyota Camry')).toBe('2020 Toyota Camry $3.34');
		expect(rowText('Hauler')).toBe('Hauler $3.34');
		expect(rowText('2020 Honda Civic')).toBe('2020 Honda Civic $3.33');
		expect(rowText('Total')).toBe('Total $10.01');
	});

	test('splits a yen total into whole yen, as the API stores it', async () => {
		const { settingsStore } = await import('#lib/stores/settings.svelte.ts');
		const spy = vi
			.spyOn(settingsStore, 'settings', 'get')
			.mockReturnValue({ currencyUnit: 'JPY' } as NonNullable<typeof settingsStore.settings>);
		try {
			renderEditor('even');
			expect(rowText('2020 Toyota Camry')).toBe('2020 Toyota Camry ¥34');
			expect(rowText('Hauler')).toBe('Hauler ¥33');
			expect(rowText('2020 Honda Civic')).toBe('2020 Honda Civic ¥33');
		} finally {
			spy.mockRestore();
		}
	});

	test('splits an evenly divisible total exactly', () => {
		renderEditor('even', [], [CAMRY, RAV4], 50);

		expect(rowText('2020 Toyota Camry')).toBe('2020 Toyota Camry $25.00');
		expect(rowText('Hauler')).toBe('Hauler $25.00');
	});

	test('renders no rows and no error with no vehicles', () => {
		renderEditor('even', [], []);

		expect(screen.queryByText('2020 Toyota Camry')).toBeNull();
		expect(screen.queryByText(/must equal/)).toBeNull();
	});
});

describe('SplitConfigEditor: fixed amounts', () => {
	const MATCHING: Allocation[] = [
		{ vehicleId: 'v1', amount: 50 },
		{ vehicleId: 'v2', amount: 30 },
		{ vehicleId: 'v3', amount: 20 }
	];

	test('accepts amounts that sum to the total', () => {
		renderEditor('absolute', MATCHING);

		expect(screen.getByLabelText('Amount for 2020 Toyota Camry')).toHaveValue(50);
		expect(rowText('Total')).toBe('Total $100.00 / $100.00');
		expect(screen.queryByText(/must equal/)).toBeNull();
	});

	test('flags amounts that do not sum to the total', () => {
		renderEditor('absolute', [
			{ vehicleId: 'v1', amount: 50 },
			{ vehicleId: 'v2', amount: 30 }
		]);

		expect(screen.getByText('Sum ($80.00) must equal total ($100.00)')).toBeInTheDocument();
		expect(screen.getByLabelText('Amount for 2020 Honda Civic')).toHaveValue(null);
		expect(screen.getByLabelText('Amount for Hauler').className).toContain('border-destructive');
	});

	test('tolerates floating-point drift in amounts that add up to the cent', () => {
		renderEditor('absolute', [
			{ vehicleId: 'v1', amount: 33.33 },
			{ vehicleId: 'v2', amount: 33.33 },
			{ vehicleId: 'v3', amount: 33.34 }
		]);

		expect(screen.queryByText(/must equal/)).toBeNull();
	});

	test('flags amounts one cent off the total, as the API does', () => {
		renderEditor('absolute', [
			{ vehicleId: 'v1', amount: 50 },
			{ vehicleId: 'v2', amount: 30 },
			{ vehicleId: 'v3', amount: 19.99 }
		]);

		expect(screen.getByText('Sum ($99.99) must equal total ($100.00)')).toBeInTheDocument();
	});

	test('editing an amount reports the updated allocations', async () => {
		const { onAllocationsChange } = renderEditor('absolute', MATCHING);

		await fireEvent.input(screen.getByLabelText('Amount for Hauler'), {
			target: { value: '12.5' }
		});

		expect(onAllocationsChange).toHaveBeenCalledWith([
			{ vehicleId: 'v1', amount: 50 },
			{ vehicleId: 'v2', amount: 12.5 },
			{ vehicleId: 'v3', amount: 20 }
		]);
	});

	test('a cleared amount is treated as zero', async () => {
		const { onAllocationsChange } = renderEditor('absolute', MATCHING);

		await fireEvent.input(screen.getByLabelText('Amount for 2020 Toyota Camry'), {
			target: { value: '' }
		});

		expect(onAllocationsChange).toHaveBeenCalledWith([
			{ vehicleId: 'v1', amount: 0 },
			{ vehicleId: 'v2', amount: 30 },
			{ vehicleId: 'v3', amount: 20 }
		]);
	});
});

describe('SplitConfigEditor: percentages', () => {
	test('accepts percentages that sum to 100', () => {
		renderEditor('percentage', [
			{ vehicleId: 'v1', percentage: 50 },
			{ vehicleId: 'v2', percentage: 25 },
			{ vehicleId: 'v3', percentage: 25 }
		]);

		expect(rowText('Total')).toBe('Total 100.00% / 100%');
		expect(screen.queryByText(/must equal/)).toBeNull();
	});

	test('accepts percentages that round to 100.00%, as the API does', () => {
		renderEditor('percentage', [
			{ vehicleId: 'v1', percentage: 33.333 },
			{ vehicleId: 'v2', percentage: 33.333 },
			{ vehicleId: 'v3', percentage: 33.333 }
		]);

		expect(rowText('Total')).toBe('Total 100.00% / 100%');
		expect(screen.queryByText(/must equal/)).toBeNull();
	});

	test.each([
		[[60, 30, 0], 'Sum (90.00%) must equal 100%'],
		[[60, 30, 20], 'Sum (110.00%) must equal 100%'],
		[[49.99, 49.99, 0], 'Sum (99.98%) must equal 100%']
	])('flags %j as not summing to 100', (percentages, message) => {
		renderEditor(
			'percentage',
			percentages.map((percentage, i) => ({ vehicleId: `v${i + 1}`, percentage }))
		);

		expect(screen.getByText(message)).toBeInTheDocument();
		expect(screen.getByLabelText('Percentage for Hauler').className).toContain(
			'border-destructive'
		);
	});

	test('treats missing percentages as zero', () => {
		renderEditor('percentage', [{ vehicleId: 'v1', percentage: 100 }, { vehicleId: 'v2' }]);

		expect(screen.queryByText(/must equal/)).toBeNull();
		expect(screen.getByLabelText('Percentage for Hauler')).toHaveValue(null);
	});

	test('editing a percentage reports the updated allocations', async () => {
		const { onAllocationsChange } = renderEditor('percentage', [
			{ vehicleId: 'v1', percentage: 50 },
			{ vehicleId: 'v2', percentage: 50 }
		]);

		await fireEvent.input(screen.getByLabelText('Percentage for 2020 Toyota Camry'), {
			target: { value: 'abc' }
		});
		await fireEvent.input(screen.getByLabelText('Percentage for Hauler'), {
			target: { value: '33.3' }
		});

		expect(onAllocationsChange.mock.calls).toEqual([
			[
				[
					{ vehicleId: 'v1', percentage: 0 },
					{ vehicleId: 'v2', percentage: 50 }
				]
			],
			[
				[
					{ vehicleId: 'v1', percentage: 50 },
					{ vehicleId: 'v2', percentage: 33.3 }
				]
			]
		]);
	});
});
