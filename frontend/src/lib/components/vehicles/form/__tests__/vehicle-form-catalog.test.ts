import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { UpdateVehicleRequest, Vehicle, VehicleFinancing } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	refreshAll: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

const getVehicle = vi.fn<(id: string) => Promise<Vehicle>>();
const createVehicle = vi.fn<(data: Partial<Vehicle>) => Promise<Vehicle>>();
const updateVehicle = vi.fn<(id: string, data: UpdateVehicleRequest) => Promise<Vehicle>>();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle,
		getFinancing: vi.fn<(id: string) => Promise<VehicleFinancing | null>>(() =>
			Promise.resolve(null)
		),
		createVehicle,
		updateVehicle,
		deleteVehicle: vi.fn(),
		createFinancing: vi.fn(),
		payOffFinancing: vi.fn()
	}
}));

const VehicleForm = (await import('../VehicleForm.svelte')).default;

const EXISTING: Vehicle = {
	id: 'veh-1',
	make: 'Honda',
	model: 'Civic EX',
	year: 2019,
	vehicleType: 'gas',
	catalogModelId: 'honda-civic',
	trackFuel: true,
	trackCharging: false,
	unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
	createdAt: '2024-03-15T12:00:00.000Z',
	updatedAt: '2024-03-15T12:00:00.000Z'
};

function field(id: string): HTMLInputElement {
	const el = document.getElementById(id);
	if (!(el instanceof HTMLInputElement)) throw new Error(`no input #${id}`);
	return el;
}

async function focusAndType(id: string, value: string): Promise<void> {
	await fireEvent.focus(field(id));
	await fireEvent.input(field(id), { target: { value } });
}

async function submit(label: RegExp): Promise<void> {
	await fireEvent.click(screen.getByRole('button', { name: label }));
}

function sentCatalogModelId(): string | null | undefined {
	const created = createVehicle.mock.calls.at(-1)?.[0];
	const updated = updateVehicle.mock.calls.at(-1)?.[1];
	return (created ?? updated)?.catalogModelId;
}

async function renderCreate(): Promise<void> {
	render(VehicleForm, { props: {} });
	await screen.findByRole('heading', { name: 'Add a vehicle' });
}

beforeEach(() => {
	vi.clearAllMocks();
	createVehicle.mockResolvedValue({ ...EXISTING, id: 'new-1' });
	updateVehicle.mockResolvedValue(EXISTING);
});

afterEach(() => {
	cleanup();
});

describe('vehicle form catalogue picker', () => {
	test('typing a make suggests catalogue makes, and the keyboard picks one', async () => {
		await renderCreate();
		await focusAndType('make', 'hon');
		const option = await screen.findByRole('option', { name: 'Honda' });
		expect(option).toHaveAttribute('tabindex', '-1');
		expect(field('make')).toHaveAttribute('aria-expanded', 'true');

		await fireEvent.keyDown(field('make'), { key: 'ArrowDown' });
		expect(field('make').getAttribute('aria-activedescendant')).toBe(option.id);
		await fireEvent.keyDown(field('make'), { key: 'Enter' });
		expect(field('make').value).toBe('Honda');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	test('Escape closes the list and keeps the typed text', async () => {
		await renderCreate();
		await focusAndType('make', 'toy');
		await screen.findByRole('option', { name: 'Toyota' });
		await fireEvent.keyDown(field('make'), { key: 'Escape' });
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(field('make').value).toBe('toy');
	});

	test('picking a model sends its catalogue id', async () => {
		await renderCreate();
		await focusAndType('make', 'Honda');
		await focusAndType('model', 'civ');
		await fireEvent.click(await screen.findByRole('option', { name: 'Civic' }));
		expect(field('model').value).toBe('Civic');

		await submit(/add vehicle|create vehicle|save/i);
		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalledTimes(1));
		expect(sentCatalogModelId()).toBe('honda-civic');
	});

	test('models are only suggested for a make the catalogue knows', async () => {
		await renderCreate();
		await focusAndType('make', 'Zastava');
		await focusAndType('model', 'Yugo');
		expect(screen.queryByRole('option')).toBeNull();
	});

	test('free text is allowed and sends no catalogue id', async () => {
		await renderCreate();
		await focusAndType('make', 'Honda');
		await focusAndType('model', 'Something Rare');
		await submit(/add vehicle|create vehicle|save/i);
		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalledTimes(1));
		expect(sentCatalogModelId()).toBeNull();
	});

	test('editing the model after picking clears the id unless it still names the entry', async () => {
		await renderCreate();
		await focusAndType('make', 'Honda');
		await focusAndType('model', 'civ');
		await fireEvent.click(await screen.findByRole('option', { name: 'Civic' }));
		await focusAndType('model', 'CIVIC');
		await submit(/add vehicle|create vehicle|save/i);
		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalledTimes(1));
		expect(sentCatalogModelId()).toBe('honda-civic');

		await focusAndType('model', 'Accord');
		await submit(/add vehicle|create vehicle|save/i);
		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalledTimes(2));
		expect(sentCatalogModelId()).toBeNull();
	});

	test('changing the make to another catalogue make clears the picked model', async () => {
		await renderCreate();
		await focusAndType('make', 'Honda');
		await focusAndType('model', 'civ');
		await fireEvent.click(await screen.findByRole('option', { name: 'Civic' }));
		await focusAndType('make', 'Toyota');
		await submit(/add vehicle|create vehicle|save/i);
		await vi.waitFor(() => expect(createVehicle).toHaveBeenCalledTimes(1));
		expect(sentCatalogModelId()).toBeNull();
	});

	test('an existing vehicle keeps its confirmed id when its text is not edited', async () => {
		getVehicle.mockResolvedValue(EXISTING);
		render(VehicleForm, { props: { vehicleId: EXISTING.id } });
		await screen.findByRole('button', { name: /save changes/i });
		await fireEvent.focus(field('make'));
		await fireEvent.focus(field('model'));
		await fireEvent.input(document.getElementById('nickname') as HTMLInputElement, {
			target: { value: 'Daily' }
		});
		await submit(/save changes/i);
		await vi.waitFor(() => expect(updateVehicle).toHaveBeenCalledTimes(1));
		expect(sentCatalogModelId()).toBe('honda-civic');
	});
});
