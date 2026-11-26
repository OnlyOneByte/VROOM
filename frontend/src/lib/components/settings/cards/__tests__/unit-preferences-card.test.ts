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

function currency(): HTMLElement {
	const el = document.getElementById('currency');
	if (!el) throw new Error('missing currency trigger');
	return el;
}

async function pickCurrency(name: string) {
	await fireEvent.click(currency());
	await settle();
	await fireEvent.pointerUp(screen.getByRole('option', { name }));
	await settle();
}

function checked(group: string): string | undefined {
	const radios = screen
		.getByRole('radiogroup', { name: group })
		.querySelectorAll('[role="radio"][aria-checked="true"]');
	return radios[0]?.textContent?.trim();
}

afterEach(() => {
	cleanup();
});

describe('UnitPreferencesCard', () => {
	test('shows the current units and currency', () => {
		mount();
		expect(checked('Distance')).toBe('Miles');
		expect(checked('Fuel')).toBe('US gal');
		expect(screen.getByTestId('charge-unit')).toHaveTextContent('kWh');
		expect(currency()).toHaveTextContent('USD – US Dollar ($)');
	});

	test.each([
		['kilometers', 'Kilometers'],
		['miles', 'Miles']
	] as const)('distance %s is checked as %s', (unit, label) => {
		mount({ distanceUnit: unit });
		expect(checked('Distance')).toBe(label);
	});

	test.each([
		['gallons_uk', 'UK gal'],
		['liters', 'Liters']
	] as const)('fuel %s is checked as %s', (unit, label) => {
		mount({ volumeUnit: unit });
		expect(checked('Fuel')).toBe(label);
	});

	test.each([
		['EUR', 'EUR – Euro (€)'],
		['GBP', 'GBP – British Pound (£)'],
		['JPY', 'JPY – Japanese Yen (¥)'],
		['CHF', 'CHF – Swiss Franc']
	])('currency %s is labelled %s', (code, label) => {
		mount({ currencyUnit: code });
		expect(currency()).toHaveTextContent(label);
	});

	test('the currency field is labelled', () => {
		mount();
		expect(screen.getByLabelText('Currency')).toBe(currency());
	});

	test('offers exactly the shared currency list', async () => {
		mount();
		await fireEvent.click(currency());
		await settle();
		const names = screen.getAllByRole('option').map(o => o.textContent?.trim());
		expect(names).toHaveLength(CURRENCIES.length);
		expect(names).toContain('INR – Indian Rupee (₹)');
	});

	test('a saved currency outside the list still shows and stays selectable', async () => {
		mount({ currencyUnit: 'BHD' });
		expect(currency()).toHaveTextContent('BHD – Bahraini Dinar');
		await fireEvent.click(currency());
		await settle();
		expect(screen.getAllByRole('option')).toHaveLength(CURRENCIES.length + 1);
	});

	test('picking a different unit or currency asks the page to save it', async () => {
		const onUnitsChange = vi.fn();
		const onCurrencyChange = vi.fn();
		mount({ onUnitsChange, onCurrencyChange });

		await fireEvent.click(screen.getByRole('radio', { name: 'Kilometers' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Liters' }));
		expect(onUnitsChange).toHaveBeenCalledTimes(2);
		expect(checked('Distance')).toBe('Kilometers');
		expect(checked('Fuel')).toBe('Liters');
		expect(onCurrencyChange).not.toHaveBeenCalled();

		await pickCurrency('GBP – British Pound (£)');
		expect(onCurrencyChange).toHaveBeenCalledOnce();
		expect(currency()).toHaveTextContent('GBP – British Pound (£)');
	});

	test('picking the value already selected saves nothing', async () => {
		const onUnitsChange = vi.fn();
		const onCurrencyChange = vi.fn();
		mount({ onUnitsChange, onCurrencyChange });

		await fireEvent.click(screen.getByRole('radio', { name: 'Miles' }));
		await pickCurrency('USD – US Dollar ($)');
		expect(onUnitsChange).not.toHaveBeenCalled();
		expect(onCurrencyChange).not.toHaveBeenCalled();
	});
});
