import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import VehicleHeader from '../VehicleHeader.svelte';
import type { Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const vehicle = { id: 'v1', year: 2020, make: 'Toyota', model: 'Camry' } as Vehicle;

describe('VehicleHeader on phones', () => {
	test('the placeholder tile is hidden below sm so the title keeps its width', () => {
		const { container } = render(VehicleHeader, { vehicle, displayName: 'Daily Driver' });

		const tile = container.querySelector('.bg-muted');
		expect(tile).toHaveClass('hidden', 'sm:flex');
		expect(screen.getByRole('heading', { level: 1, name: 'Daily Driver' })).toBeInTheDocument();
	});

	test('the cover photo is hidden below sm and shown from sm up', () => {
		render(VehicleHeader, { vehicle, displayName: 'Daily Driver', coverPhotoUrl: '/c.jpg' });

		expect(screen.getByRole('img', { name: '2020 Toyota Camry' })).toHaveClass(
			'hidden',
			'sm:block'
		);
	});
});
