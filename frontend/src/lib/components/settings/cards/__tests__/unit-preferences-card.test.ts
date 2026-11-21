import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import UnitPreferencesCard from '../UnitPreferencesCard.svelte';

interface CardProps {
	distanceUnit: 'miles' | 'kilometers';
	volumeUnit: 'gallons_us' | 'gallons_uk' | 'liters';
	chargeUnit: 'kwh';
	currencyUnit: string;
}

function mount(overrides: Partial<CardProps> = {}) {
	return render(UnitPreferencesCard, {
		props: {
			distanceUnit: 'miles',
			volumeUnit: 'gallons_us',
			chargeUnit: 'kwh',
			currencyUnit: 'USD',
			...overrides
		}
	});
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

function trigger(id: string): HTMLElement {
	const el = document.getElementById(id);
	if (!el) throw new Error(`missing trigger ${id}`);
	return el;
}

async function pickOption(id: string, name: string) {
	await fireEvent.click(trigger(id));
	await settle();
	await fireEvent.pointerUp(screen.getByRole('option', { name }));
	await settle();
}

afterEach(() => {
	cleanup();
});

describe('UnitPreferencesCard', () => {
	test('labels each trigger with the current unit', () => {
		mount();
		expect(trigger('distance-unit')).toHaveTextContent('Miles');
		expect(trigger('volume-unit')).toHaveTextContent('Gallons (US)');
		expect(trigger('charge-unit')).toHaveTextContent('kWh');
		expect(trigger('currency')).toHaveTextContent('USD ($)');
	});

	test.each([
		['kilometers', 'Kilometers'],
		['miles', 'Miles']
	] as const)('distance %s is labelled %s', (unit, label) => {
		mount({ distanceUnit: unit });
		expect(trigger('distance-unit')).toHaveTextContent(label);
	});

	test.each([
		['gallons_uk', 'Gallons (UK)'],
		['liters', 'Liters']
	] as const)('volume %s is labelled %s', (unit, label) => {
		mount({ volumeUnit: unit });
		expect(trigger('volume-unit')).toHaveTextContent(label);
	});

	test.each([
		['EUR', 'EUR (€)'],
		['GBP', 'GBP (£)'],
		['CAD', 'CAD ($)'],
		['AUD', 'AUD ($)'],
		['JPY', 'JPY']
	])('currency %s is labelled %s', (code, label) => {
		mount({ currencyUnit: code });
		expect(trigger('currency')).toHaveTextContent(label);
	});

	test('picking a distance unit updates the selection', async () => {
		mount();
		await pickOption('distance-unit', 'Kilometers');
		expect(trigger('distance-unit')).toHaveTextContent('Kilometers');
	});

	test('picking a volume unit updates the selection', async () => {
		mount();
		await pickOption('volume-unit', 'Liters');
		expect(trigger('volume-unit')).toHaveTextContent('Liters');
	});

	test('picking a currency updates the selection', async () => {
		mount();
		await pickOption('currency', 'GBP (£)');
		expect(trigger('currency')).toHaveTextContent('GBP (£)');
	});

	test('the charge unit offers kWh', async () => {
		mount();
		await pickOption('charge-unit', 'kWh');
		expect(trigger('charge-unit')).toHaveTextContent('kWh');
	});
});
