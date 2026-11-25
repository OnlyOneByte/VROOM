import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	refreshAll: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

const getVehicle = vi.fn<(id: string) => Promise<Vehicle>>();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicle,
		getFinancing: vi.fn(() => Promise.resolve(null)),
		createVehicle: vi.fn(),
		updateVehicle: vi.fn(),
		deleteVehicle: vi.fn()
	}
}));

const VehicleForm = (await import('../VehicleForm.svelte')).default;

function expectSharedPageTitle(name: string, backLabel: string): HTMLElement {
	const headings = screen.getAllByRole('heading', { level: 1 });
	expect(headings).toHaveLength(1);
	expect(headings[0]).toHaveTextContent(name);
	expect(headings[0]).toHaveClass('uppercase', 'font-bold', 'break-words');
	const back = screen.getByRole('button', { name: backLabel });
	expect(
		back.compareDocumentPosition(headings[0]!) & Node.DOCUMENT_POSITION_FOLLOWING
	).toBeTruthy();
	return headings[0]!;
}

describe('VehicleForm page title', () => {
	test('create mode renders the one PageHeader title with its description and a back button', async () => {
		render(VehicleForm, { props: {} });
		await screen.findByRole('heading', { name: 'Add a vehicle' });

		expectSharedPageTitle('Add a vehicle', 'Back to garage');
		expect(screen.getByText('You can change any of this later.')).toBeTruthy();
	});

	test('edit mode shows a form-shaped skeleton under the title while the vehicle loads', async () => {
		getVehicle.mockReturnValue(new Promise(() => {}));
		const { container } = render(VehicleForm, { props: { vehicleId: 'veh-1' } });

		const loading = await screen.findByRole('status', { name: 'Loading vehicle' });
		expectSharedPageTitle('Edit vehicle', 'Back to the vehicle');
		expect(loading).toHaveTextContent('Loading vehicle');
		expect(loading.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(10);
		expect(container.querySelector('.animate-spin')).toBeNull();

		const actions = screen.getByTestId('vehicle-form-loading-actions');
		expect(actions).toHaveAttribute('aria-hidden', 'true');
		expect(actions.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
	});

	test('Cancel and Save vehicle sit in a plain row at the end of the form, not a floating bar', async () => {
		render(VehicleForm, { props: {} });
		const save = await screen.findByRole('button', { name: 'Save vehicle' });
		const cancel = screen.getByRole('button', { name: 'Cancel' });

		expect(save.closest('.fixed')).toBeNull();
		expect(save.parentElement).toBe(cancel.parentElement);
	});

	test('edit mode names the vehicle under the title', async () => {
		getVehicle.mockResolvedValue({
			id: 'veh-1',
			make: 'Honda',
			model: 'Civic',
			year: 2019,
			vehicleType: 'gas',
			trackFuel: true,
			trackCharging: false,
			nickname: 'Weekend Car',
			createdAt: '2024-01-01T00:00:00.000Z',
			updatedAt: '2024-01-01T00:00:00.000Z'
		});
		render(VehicleForm, { props: { vehicleId: 'veh-1' } });
		await screen.findByRole('button', { name: /save changes/i });

		expectSharedPageTitle('Edit vehicle', 'Back to the vehicle');
		expect(screen.getByText('Weekend Car')).toBeTruthy();
	});
});
