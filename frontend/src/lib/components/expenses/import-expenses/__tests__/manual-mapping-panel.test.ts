import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
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

describe('ManualMappingPanel: column mapping', () => {
	test('lists every column in the file with its first value, none imported yet', () => {
		const form = manualForm();
		form.csvText = `${HEADERS.join(',')}\n2025-03-14,38.20,28410,9.82,Camry`;
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });

		const rows = within(screen.getByTestId('column-mapping')).getAllByRole('row').slice(1);
		const cells = (row: HTMLElement) =>
			[...row.querySelectorAll('th, td')].map(c => c.textContent?.trim());
		expect(rows.map(cells)).toEqual([
			['When', '2025-03-14', "Don't import"],
			['Spent', '38.20', "Don't import"],
			['Odo', '28410', "Don't import"],
			['Litres', '9.82', "Don't import"],
			['Car', 'Camry', "Don't import"]
		]);
		expect(screen.getByTestId('mapping-missing')).toHaveTextContent(
			'Still needed: Date and Amount'
		);
	});

	test('a quoted example with a comma stays in its own column', () => {
		const form = manualForm();
		form.csvText = `${HEADERS.join(',')}\n2025-03-14,38.20,28410,9.82,"Camry, blue"\r\n`;
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });

		const rows = within(screen.getByTestId('column-mapping')).getAllByRole('row').slice(1);
		expect(rows.at(-1)?.querySelector('td')?.textContent?.trim()).toBe('Camry, blue');
		expect(rows).toHaveLength(HEADERS.length);
	});

	test('a column is named by its header and records the field chosen for it', async () => {
		const form = manualForm();
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });

		await pick(screen.getByLabelText('Spent'), 'Amount *');

		expect(form.manualColumns.amount).toBe('Spent');
		expect(screen.getByLabelText('Spent')).toHaveTextContent('Amount *');
		expect(screen.getByTestId('mapping-missing')).toHaveTextContent('Still needed: Date');
	});

	test('giving a field to another column moves it, and the first column goes back to not imported', async () => {
		const form = manualForm();
		form.manualColumns = { date: 'When' };
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });

		await pick(screen.getByLabelText('Odo'), 'Date *');

		expect(form.manualColumns.date).toBe('Odo');
		expect(screen.getByLabelText('When')).toHaveTextContent("Don't import");
	});

	test("choosing Don't import clears that column's field", async () => {
		const form = manualForm();
		form.manualColumns = { date: 'When' };
		render(ManualMappingPanel, { form, vehicles: [CAMRY] });

		await pick(screen.getByLabelText('When'), "Don't import");

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
