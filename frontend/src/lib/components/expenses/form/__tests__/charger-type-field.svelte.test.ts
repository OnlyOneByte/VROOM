import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import FuelTypeFields from '../FuelTypeFields.svelte';
import type { ChargerType } from '#lib/types/index.ts';

afterEach(() => cleanup());

function mount(energyMode: 'fuel' | 'charging', fuelType = '', chargerType: ChargerType | '' = '') {
	const state = $state({ fuelType, chargerType, missedFillup: false });
	render(FuelTypeFields, {
		energyMode,
		get fuelType() {
			return state.fuelType;
		},
		set fuelType(value: string) {
			state.fuelType = value;
		},
		get chargerType() {
			return state.chargerType;
		},
		set chargerType(value: ChargerType | '') {
			state.chargerType = value;
		},
		get missedFillup() {
			return state.missedFillup;
		},
		set missedFillup(value: boolean) {
			state.missedFillup = value;
		},
		onBlur: () => {}
	});
	return state;
}

async function choose(triggerId: string, name: string) {
	const trigger = document.getElementById(triggerId);
	if (!trigger) throw new Error(`missing #${triggerId}`);
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

describe('where you charged', () => {
	test('is offered for a charge and not for a fill-up', () => {
		mount('fuel');
		expect(document.getElementById('chargerType')).toBeNull();
		cleanup();
		mount('charging');
		expect(document.getElementById('chargerType')).toHaveTextContent('Not set (optional)');
	});

	test('picking a charger records it, and Not set clears it', async () => {
		const state = mount('charging', 'Electric');
		await choose('chargerType', 'Home');
		expect(state.chargerType).toBe('home');
		await choose('chargerType', 'Not set');
		expect(state.chargerType).toBe('');
	});

	test('DC Fast Charging pre-selects DC fast, which stays editable', async () => {
		const state = mount('charging');
		await choose('fuelType', 'DC Fast Charging');
		expect(state.chargerType).toBe('dc_fast');
		await choose('chargerType', 'Public Level 2');
		expect(state.chargerType).toBe('public_l2');
	});

	test('Level 1 and Level 2 leave it unset, and an existing choice is kept', async () => {
		const state = mount('charging');
		await choose('fuelType', 'Level 2 (AC)');
		expect(state.chargerType).toBe('');
		await choose('fuelType', 'Level 1 (Home)');
		expect(state.chargerType).toBe('');

		cleanup();
		const kept = mount('charging', '', 'workplace');
		await choose('fuelType', 'DC Fast Charging');
		expect(kept.chargerType).toBe('workplace');
	});
});
