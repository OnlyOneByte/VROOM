import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { CURRENCIES } from '#lib/constants/currencies.ts';
import UnitPreferencesCard from '../UnitPreferencesCard.svelte';

interface CardProps {
	distanceUnit: 'miles' | 'kilometers';
	volumeUnit: 'gallons_us' | 'gallons_uk' | 'liters';
	chargeUnit: 'kwh';
	currencyUnit: string;
	businessMileageRate: number;
	onUnitsChange: () => void;
	onCurrencyChange: () => void;
	onRateChange: () => void;
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
		['CAD', 'CAD – Canadian Dollar (CA$)'],
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
		expect(currency()).toHaveTextContent(label);
		await fireEvent.click(currency());
		await settle();
		expect(screen.getByRole('option', { name: label })).toBeTruthy();
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

	test('switching to a currency without cents asks first, and Cancel keeps the old one', async () => {
		const onCurrencyChange = vi.fn();
		mount({ onCurrencyChange });

		await pickCurrency('JPY – Japanese Yen (¥)');
		const dialog = screen.getByRole('alertdialog');
		expect(dialog).toHaveTextContent('Switch to JPY – Japanese Yen (¥)?');
		expect(dialog).toHaveTextContent('rounded to a whole number');
		expect(onCurrencyChange).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await settle();
		expect(onCurrencyChange).not.toHaveBeenCalled();
		expect(currency()).toHaveTextContent('USD – US Dollar ($)');

		await fireEvent.click(currency());
		await settle();
		expect(screen.getByRole('option', { name: 'USD – US Dollar ($)' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await fireEvent.pointerUp(screen.getByRole('option', { name: 'JPY – Japanese Yen (¥)' }));
		await settle();
		expect(screen.getByRole('alertdialog')).toHaveTextContent('Switch to JPY');
	});

	test('confirming the switch saves the currency without cents', async () => {
		const onCurrencyChange = vi.fn();
		mount({ onCurrencyChange });

		await pickCurrency('JPY – Japanese Yen (¥)');
		await fireEvent.click(screen.getByRole('button', { name: 'Switch and round' }));
		await settle();
		expect(onCurrencyChange).toHaveBeenCalledOnce();
		expect(currency()).toHaveTextContent('JPY – Japanese Yen (¥)');
	});

	test('moving to a currency with cents, or between two without, needs no confirmation', async () => {
		const onCurrencyChange = vi.fn();
		mount({ currencyUnit: 'JPY', onCurrencyChange });

		await pickCurrency('KRW – South Korean Won (₩)');
		await pickCurrency('EUR – Euro (€)');
		expect(screen.queryByRole('alertdialog')).toBeNull();
		expect(onCurrencyChange).toHaveBeenCalledTimes(2);
	});

	describe('business mileage rate', () => {
		function rate(): HTMLInputElement {
			return screen.getByRole('textbox', { name: 'Business mileage rate' }) as HTMLInputElement;
		}

		async function enter(value: string) {
			await fireEvent.input(rate(), { target: { value } });
			await fireEvent.change(rate());
			await settle();
		}

		test('shows the saved rate, per the distance unit, in the currency', () => {
			mount({ businessMileageRate: 0.67 });
			expect(rate()).toHaveValue('0.67');
			expect(rate()).toHaveAccessibleDescription(/\$ per mile/);
		});

		test('in kilometres and euros the hint says € per km', () => {
			mount({ distanceUnit: 'kilometers', currencyUnit: 'EUR' });
			expect(rate()).toHaveValue('');
			expect(rate()).toHaveAccessibleDescription(/€ per km/);
		});

		test('a new rate is saved once, a decimal comma included', async () => {
			const onRateChange = vi.fn();
			mount({ onRateChange });

			await enter('0,45');

			expect(onRateChange).toHaveBeenCalledOnce();
			expect(rate()).not.toHaveAttribute('aria-invalid');
		});

		test.each([
			['USD', '-1', 'Use a number like 0.67'],
			['USD', 'abc', 'Use a number like 0.67'],
			['USD', '0x10', 'Use a number like 0.67'],
			['USD', '1e3', 'Use a number like 0.67'],
			['USD', '1000001', 'Use 1000000 or less'],
			['KRW', '1,000', 'Leave out thousands separators'],
			['KRW', '100.000', 'Leave out thousands separators']
		])(
			'in %s, "%s" is refused with "%s", announced and not saved',
			async (currencyUnit, typed, message) => {
				const onRateChange = vi.fn();
				mount({ currencyUnit, onRateChange });

				await enter(typed);

				expect(rate()).toHaveAttribute('aria-invalid', 'true');
				expect(rate()).toHaveAccessibleDescription(new RegExp(message));
				expect(screen.getByRole('alert')).toHaveTextContent(message);
				expect(rate()).toHaveValue(typed);
				expect(onRateChange).not.toHaveBeenCalled();
			}
		);

		test.each(['2.414', '4.828', '1,125', '.5', '5.', '0,670'])(
			'in USD, "%s" is a plain decimal and saves',
			async typed => {
				const onRateChange = vi.fn();
				mount({ onRateChange });

				await enter(typed);

				expect(rate()).not.toHaveAttribute('aria-invalid');
				expect(onRateChange).toHaveBeenCalledOnce();
			}
		);

		test('fixing a refused rate clears the error and saves it', async () => {
			const onRateChange = vi.fn();
			mount({ currencyUnit: 'KRW', onRateChange });

			await enter('1,000');
			await enter('300');

			expect(onRateChange).toHaveBeenCalledOnce();
			expect(rate()).not.toHaveAttribute('aria-invalid');
			expect(screen.queryByRole('alert')).toBeNull();
		});

		test('the #business-mileage-rate link lands on the field and focuses it', () => {
			const scrollIntoView = vi.fn();
			const realScroll = Element.prototype.scrollIntoView;
			Element.prototype.scrollIntoView = scrollIntoView;
			vi.stubGlobal(
				'ResizeObserver',
				class {
					observe() {}
					disconnect() {}
				}
			);
			history.replaceState(null, '', '#business-mileage-rate');
			try {
				mount();
				expect(rate()).toHaveFocus();
				expect(scrollIntoView.mock.contexts[0]).toBe(rate());
			} finally {
				cleanup();
				history.replaceState(null, '', location.pathname);
				vi.unstubAllGlobals();
				Element.prototype.scrollIntoView = realScroll;
			}
		});

		test('clearing the field turns the rate off; re-entering the same rate saves nothing', async () => {
			const onRateChange = vi.fn();
			mount({ businessMileageRate: 0.67, onRateChange });

			await enter('0.67');
			expect(onRateChange).not.toHaveBeenCalled();

			await enter('');
			expect(onRateChange).toHaveBeenCalledOnce();
		});
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
