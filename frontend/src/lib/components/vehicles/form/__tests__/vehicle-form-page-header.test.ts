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

function expectSharedPageTitle(name: string): HTMLElement {
	const headings = screen.getAllByRole('heading', { level: 1 });
	expect(headings).toHaveLength(1);
	expect(headings[0]).toHaveTextContent(name);
	expect(headings[0]).toHaveClass('text-3xl', 'font-bold', 'tracking-tight', 'break-words');
	const back = screen.getByRole('button', { name: 'Go back' });
	expect(
		back.compareDocumentPosition(headings[0]!) & Node.DOCUMENT_POSITION_FOLLOWING
	).toBeTruthy();
	return headings[0]!;
}

describe('VehicleForm page title', () => {
	test('create mode renders the one PageHeader title with its description and a back button', async () => {
		render(VehicleForm, { props: {} });
		await screen.findByRole('heading', { name: 'Add Vehicle' });

		expectSharedPageTitle('Add Vehicle');
		expect(
			screen.getByText('Enter your vehicle information and optional financing details')
		).toBeTruthy();
	});

	test('edit mode shows a form-shaped skeleton under the title while the vehicle loads', async () => {
		getVehicle.mockReturnValue(new Promise(() => {}));
		const { container } = render(VehicleForm, { props: { vehicleId: 'veh-1' } });

		const loading = await screen.findByRole('status', { name: 'Loading vehicle' });
		expectSharedPageTitle('Edit Vehicle');
		expect(loading).toHaveTextContent('Loading vehicle');
		expect(loading.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(10);
		expect(container.querySelector('.animate-spin')).toBeNull();

		const actions = screen.getByTestId('vehicle-form-loading-actions');
		expect(actions).toHaveAttribute('aria-hidden', 'true');
		expect(actions).toHaveClass('fixed', 'bottom-4', 'sm:bottom-8');
		expect(actions.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
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
		await screen.findByRole('button', { name: /update vehicle/i });

		expectSharedPageTitle('Edit Vehicle');
		expect(screen.getByText('Weekend Car')).toBeTruthy();
	});
});
