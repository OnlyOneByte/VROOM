import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import { ImportExpensesForm } from '../import-expenses-form.svelte';
import ManualMappingPanel from '../ManualMappingPanel.svelte';

const mocks = vi.hoisted(() => ({
	detectImportSource: vi.fn(),
	importExpensesCsv: vi.fn(),
	addNotification: vi.fn()
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		detectImportSource: mocks.detectImportSource,
		importExpensesCsv: mocks.importExpensesCsv
	}
}));

vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { addNotification: mocks.addNotification }
}));

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
const RAV4: Vehicle = { ...CAMRY, id: 'v2', model: 'RAV4' };

const HEADERS = ['When', 'Spent', 'Odo', 'Litres', 'Car'];

function manualForm(): ImportExpensesForm {
	const form = new ImportExpensesForm(() => [CAMRY, RAV4]);
	form.fileHeaders = HEADERS;
	form.manualMapping = true;
	return form;
}

async function pick(trigger: HTMLElement, name: string): Promise<void> {
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('ManualMappingPanel: field mapping', () => {
	test('lists every mappable field, marking Date and Amount as required, all unmapped', () => {
		render(ManualMappingPanel, { form: manualForm(), vehicles: [CAMRY] });

		expect(screen.getByText('Date *')).toBeInTheDocument();
		expect(screen.getByText('Amount *')).toBeInTheDocument();
		for (const field of [
			'date',
			'amount',
			'category',
			'vehicle',
			'mileage',
			'volume',
			'fuelType',
			'description',
			'tags'
		]) {
			expect(screen.getByTestId(`map-field-${field}`)).toHaveTextContent('— not mapped —');
		}
	});

	test('offers the file headers as columns and records the chosen one', async () => {
		const form = manualForm();
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });

		await pick(screen.getByTestId('map-field-amount'), 'Spent');

		expect(form.manualColumns.amount).toBe('Spent');
		expect(screen.getByTestId('map-field-amount')).toHaveTextContent('Spent');
	});

	test('choosing not mapped clears a field', async () => {
		const form = manualForm();
		form.manualColumns = { date: 'When' };
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });

		await pick(screen.getByTestId('map-field-date'), '— not mapped —');

		expect(form.manualColumns.date).toBe('');
	});
});

describe('ManualMappingPanel: formats and units', () => {
	test('defaults the date format to ISO and records a change', async () => {
		const form = manualForm();
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });
		const trigger = screen.getByLabelText('Date format');
		expect(trigger).toHaveTextContent('ISO (YYYY-MM-DD)');

		await pick(trigger, 'EU (DD/MM/YYYY)');

		expect(form.manualDateFormat).toBe('dmy');
		expect(trigger).toHaveTextContent('EU (DD/MM/YYYY)');
	});

	test('hides unit pickers until odometer or volume columns are mapped', () => {
		render(ManualMappingPanel, { form: manualForm(), vehicles: [CAMRY] });

		expect(screen.queryByTestId('map-distance-unit')).toBeNull();
		expect(screen.queryByTestId('map-volume-unit')).toBeNull();
	});

	test('an odometer column reveals a distance unit picker', async () => {
		const form = manualForm();
		form.manualColumns = { mileage: 'Odo' };
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });
		expect(screen.getByTestId('map-distance-unit')).toHaveTextContent('Miles');

		await pick(screen.getByTestId('map-distance-unit'), 'Kilometers');

		expect(form.manualDistanceUnit).toBe('kilometers');
	});

	test('a volume column reveals a volume unit picker', async () => {
		const form = manualForm();
		form.manualColumns = { volume: 'Litres' };
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });
		expect(screen.getByTestId('map-volume-unit')).toHaveTextContent('Gallons (US)');

		await pick(screen.getByTestId('map-volume-unit'), 'Liters');

		expect(form.manualVolumeUnit).toBe('liters');
	});
});

describe('ManualMappingPanel: target vehicle', () => {
	test('asks for a target vehicle when no vehicle column is mapped', async () => {
		const form = manualForm();
		render(ManualMappingPanel, { form, vehicles: [CAMRY, RAV4] });

		await pick(screen.getByLabelText('Import into vehicle *'), '2020 Toyota RAV4');

		expect(form.targetVehicleId).toBe('v2');
	});

	test('explains that a vehicle is needed when the user has none', () => {
		render(ManualMappingPanel, { form: manualForm(), vehicles: [] });

		expect(screen.getByText('Add a vehicle first to import.')).toBeInTheDocument();
	});

	test('drops the target vehicle picker once a vehicle column is mapped', () => {
		const form = manualForm();
		form.manualColumns = { vehicle: 'Car' };
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });

		expect(screen.queryByText('Import into vehicle *')).toBeNull();
	});
});
