import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import NoVehiclesEmptyState, { addVehicleFirstTo } from '../NoVehiclesEmptyState.svelte';

describe('NoVehiclesEmptyState', () => {
	test('names the missing vehicle, explains why with the page text, and links to Add Vehicle', () => {
		render(NoVehiclesEmptyState, { description: 'Every trip belongs to a vehicle.' });

		expect(
			screen.getByRole('heading', { level: 2, name: 'Add a vehicle first' })
		).toBeInTheDocument();
		expect(screen.getByText('Every trip belongs to a vehicle.')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add Vehicle' })).toHaveAttribute(
			'href',
			'/vehicles/new'
		);
	});

	test('takes a heading level for pages that already have an h2 above it', () => {
		render(NoVehiclesEmptyState, { description: 'x', level: 3 });

		expect(
			screen.getByRole('heading', { level: 3, name: 'Add a vehicle first' })
		).toBeInTheDocument();
	});

	test('inline notes reuse the same wording', () => {
		expect(addVehicleFirstTo('log a trip')).toBe('Add a vehicle first to log a trip.');
	});
});
