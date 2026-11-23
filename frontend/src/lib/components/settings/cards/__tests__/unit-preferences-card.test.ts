import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { CURRENCIES } from '#lib/constants/currencies.ts';
import UnitPreferencesCard from '../UnitPreferencesCard.svelte';

interface CardProps {
	distanceUnit: 'miles' | 'kilometers';
	volumeUnit: 'gallons_us' | 'gallons_uk' | 'liters';
	chargeUnit: 'kwh';
	currencyUnit: string;
	onUnitsChange: () => void;
	onCurrencyChange: () => void;
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
		expect(trigger('currency')).toHaveTextContent('USD – US Dollar ($)');
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
		['EUR', 'EUR – Euro (€)'],
		['GBP', 'GBP – British Pound (£)'],
		['CAD', 'CAD – Canadian Dollar (CA$)'],
		['JPY', 'JPY – Japanese Yen (¥)'],
		['CHF', 'CHF – Swiss Franc']
	])('currency %s is labelled %s', (code, label) => {
		mount({ currencyUnit: code });
		expect(trigger('currency')).toHaveTextContent(label);
	});

	test('offers exactly the shared currency list', async () => {
		mount();
		await fireEvent.click(trigger('currency'));
		await settle();
		const names = screen.getAllByRole('option').map(o => o.textContent?.trim());
		expect(names).toHaveLength(CURRENCIES.length);
		expect(names).toContain('JPY – Japanese Yen (¥)');
		expect(names).toContain('INR – Indian Rupee (₹)');
		for (const dropped of ['BHD', 'KWD', 'IQD', 'HRK', 'BGN', 'XDR', 'SLL']) {
			expect(
				names.some(n => n?.startsWith(dropped)),
				dropped
			).toBe(false);
		}
	});

	test.each([
		['BHD', 'BHD – Bahraini Dinar'],
		['HRK', 'HRK – Croatian Kuna']
	])('a saved %s outside the list still shows and stays selectable', async (code, label) => {
		mount({ currencyUnit: code });
		expect(trigger('currency')).toHaveTextContent(label);
		await fireEvent.click(trigger('currency'));
		await settle();
		expect(screen.getByRole('option', { name: label })).toBeTruthy();
		expect(screen.getAllByRole('option')).toHaveLength(CURRENCIES.length + 1);
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
		await pickOption('currency', 'GBP – British Pound (£)');
		expect(trigger('currency')).toHaveTextContent('GBP – British Pound (£)');
	});

	test('the charge unit offers kWh', async () => {
		mount();
		await pickOption('charge-unit', 'kWh');
		expect(trigger('charge-unit')).toHaveTextContent('kWh');
	});

	test('picking a different unit or currency asks the page to save it', async () => {
		const onUnitsChange = vi.fn();
		const onCurrencyChange = vi.fn();
		mount({ onUnitsChange, onCurrencyChange });

		await pickOption('distance-unit', 'Kilometers');
		await pickOption('volume-unit', 'Liters');
		expect(onUnitsChange).toHaveBeenCalledTimes(2);
		expect(onCurrencyChange).not.toHaveBeenCalled();

		await pickOption('currency', 'GBP – British Pound (£)');
		expect(onCurrencyChange).toHaveBeenCalledOnce();
	});

	test('picking the value already selected saves nothing', async () => {
		const onUnitsChange = vi.fn();
		const onCurrencyChange = vi.fn();
		mount({ onUnitsChange, onCurrencyChange });

		await pickOption('charge-unit', 'kWh');
		await pickOption('currency', 'USD – US Dollar ($)');
		expect(onUnitsChange).not.toHaveBeenCalled();
		expect(onCurrencyChange).not.toHaveBeenCalled();
	});
});
