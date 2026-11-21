import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { reactiveState } from '../../../../../test-utils/reactive-state.svelte';
import FuelFieldsSection from '../FuelFieldsSection.svelte';
import type { DistanceUnit, VolumeUnit } from '#lib/types/index.ts';

interface Options {
	trackFuel?: boolean;
	trackCharging?: boolean;
	volume?: string;
	charge?: string;
	fuelType?: string;
	amount?: string;
	volumeUnit?: VolumeUnit;
	distanceUnit?: DistanceUnit;
	calculatedMpg?: number | null;
	calculatedEfficiency?: number | null;
	showMpgCalculation?: boolean;
	errors?: Record<string, string | undefined>;
	touched?: Record<string, boolean>;
}

function mount(options: Options = {}) {
	const form = reactiveState({
		volume: options.volume ?? '',
		charge: options.charge ?? '',
		fuelType: options.fuelType ?? '',
		missedFillup: false
	});
	const onBlur = vi.fn();
	const onMileageChange = vi.fn();
	const { container } = render(FuelFieldsSection, {
		trackFuel: options.trackFuel ?? true,
		trackCharging: options.trackCharging ?? false,
		get volume() {
			return form.volume;
		},
		set volume(value: string) {
			form.volume = value;
		},
		get charge() {
			return form.charge;
		},
		set charge(value: string) {
			form.charge = value;
		},
		get fuelType() {
			return form.fuelType;
		},
		set fuelType(value: string) {
			form.fuelType = value;
		},
		get missedFillup() {
			return form.missedFillup;
		},
		set missedFillup(value: boolean) {
			form.missedFillup = value;
		},
		amount: options.amount ?? '',
		volumeUnit: options.volumeUnit ?? 'gallons_us',
		chargeUnit: 'kwh',
		distanceUnit: options.distanceUnit ?? 'miles',
		calculatedMpg: options.calculatedMpg ?? null,
		calculatedEfficiency: options.calculatedEfficiency ?? null,
		showMpgCalculation: options.showMpgCalculation ?? false,
		errors: options.errors ?? {},
		touched: options.touched ?? {},
		onBlur,
		onMileageChange
	});
	return {
		container,
		form,
		onBlur,
		onMileageChange,
		trigger: () => container.querySelector<HTMLElement>('#fuelType')!,
		input: (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)
	};
}

const EV = { trackFuel: false, trackCharging: true };
const HYBRID = { trackFuel: true, trackCharging: true };

async function openSelect(trigger: HTMLElement) {
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
}

async function chooseOption(name: string) {
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

describe('volume field', () => {
	test('labels the volume input with the vehicle volume unit', () => {
		mount({ volumeUnit: 'liters' });
		expect(screen.getByText('Liters *')).toBeInTheDocument();
	});

	test('shows a touched volume error and links it to the input', () => {
		const section = mount({ errors: { volume: 'Volume is required' }, touched: { volume: true } });
		const volume = section.input('volume')!;
		expect(volume).toHaveAttribute('aria-invalid', 'true');
		expect(volume).toHaveAttribute('aria-describedby', 'volume-error');
		expect(section.container.querySelector('#volume-error')).toHaveTextContent(
			'Volume is required'
		);
	});

	test('hides a volume error until the field is touched', () => {
		const section = mount({ errors: { volume: 'Volume is required' } });
		const volume = section.input('volume')!;
		expect(volume).toHaveAttribute('aria-invalid', 'false');
		expect(volume).not.toHaveAttribute('aria-describedby');
		expect(section.container.querySelector('#volume-error')).toBeNull();
	});

	test('reports blur and input on the volume field', async () => {
		const section = mount();
		const volume = section.input('volume')!;
		await fireEvent.input(volume, { target: { value: '10' } });
		await fireEvent.blur(volume);
		expect(section.onMileageChange).toHaveBeenCalled();
		expect(section.onBlur).toHaveBeenCalledWith('volume');
	});

	test('shows the price per unit when both volume and amount are present', () => {
		mount({ volume: '10', amount: '40' });
		expect(screen.getByText('Price per gal:')).toBeInTheDocument();
		expect(screen.getByText('Price per gal:').parentElement).toHaveTextContent('4.000');
	});

	test('omits the price per unit without an amount', () => {
		mount({ volume: '10' });
		expect(screen.queryByText(/Price per/)).toBeNull();
	});
});

describe('fuel type select', () => {
	test('shows the chosen fuel type in the trigger', () => {
		const section = mount({ fuelType: 'Diesel' });
		expect(section.trigger()).toHaveTextContent('Diesel');
	});

	test('choosing a listed fuel type stores it', async () => {
		const section = mount();
		await openSelect(section.trigger());
		await chooseOption('91 (Premium)');
		expect(section.form.fuelType).toBe('91 (Premium)');
		expect(section.trigger()).toHaveTextContent('91 (Premium)');
		expect(section.input('customFuelType')).toBeNull();
	});

	test('choosing Other reveals a custom fuel type input that reports its blur', async () => {
		const section = mount({ fuelType: 'Diesel' });
		await openSelect(section.trigger());
		await chooseOption('Other (Custom)');

		expect(section.form.fuelType).toBe('');
		expect(section.trigger()).toHaveTextContent('Other (Custom)');
		const custom = section.input('customFuelType')!;
		await fireEvent.input(custom, { target: { value: 'E85' } });
		await fireEvent.blur(custom);
		expect(section.form.fuelType).toBe('E85');
		expect(section.onBlur).toHaveBeenCalledWith('fuelType');
	});

	test('choosing a listed fuel type after Other hides the custom input', async () => {
		const section = mount();
		await openSelect(section.trigger());
		await chooseOption('Other (Custom)');
		await openSelect(section.trigger());
		await chooseOption('Diesel');

		expect(section.input('customFuelType')).toBeNull();
		expect(section.form.fuelType).toBe('Diesel');
	});
});

describe('charging fields', () => {
	test('labels the charge input in kWh and offers the charging types', async () => {
		const section = mount({ ...EV });
		expect(screen.getByText('kWh *')).toBeInTheDocument();
		expect(screen.getByText('Charging Type')).toBeInTheDocument();
		await openSelect(section.trigger());
		const options = await screen.findAllByRole('option');
		expect(options.map(option => option.textContent?.trim())).toEqual([
			'Level 1 (Home)',
			'Level 2 (AC)',
			'DC Fast Charging',
			'Electric'
		]);
	});

	test('choosing a charging type stores it', async () => {
		const section = mount({ ...EV });
		await openSelect(section.trigger());
		await chooseOption('DC Fast Charging');
		expect(section.form.fuelType).toBe('DC Fast Charging');
		expect(section.trigger()).toHaveTextContent('DC Fast Charging');
	});

	test('shows the charging type placeholder once the seeded type is cleared', async () => {
		const section = mount({ ...HYBRID });
		await fireEvent.click(screen.getByRole('button', { name: 'Charging' }));
		section.form.fuelType = '';
		await Promise.resolve();
		expect(section.trigger()).toHaveTextContent('Select charging type');
	});

	test('shows a touched charge error and links it to the input', () => {
		const section = mount({
			...EV,
			errors: { charge: 'Charge is required' },
			touched: { charge: true }
		});
		const charge = section.input('charge')!;
		expect(charge).toHaveAttribute('aria-invalid', 'true');
		expect(charge).toHaveAttribute('aria-describedby', 'charge-error');
		expect(section.container.querySelector('#charge-error')).toHaveTextContent(
			'Charge is required'
		);
	});

	test('hides a charge error until the field is touched', () => {
		const section = mount({ ...EV, errors: { charge: 'Charge is required' } });
		expect(section.input('charge')).not.toHaveAttribute('aria-describedby');
		expect(section.container.querySelector('#charge-error')).toBeNull();
	});

	test('reports blur and input on the charge field', async () => {
		const section = mount({ ...EV });
		const charge = section.input('charge')!;
		await fireEvent.input(charge, { target: { value: '30' } });
		await fireEvent.blur(charge);
		expect(section.onMileageChange).toHaveBeenCalled();
		expect(section.onBlur).toHaveBeenCalledWith('charge');
	});

	test('shows the price per kWh when both charge and amount are present', () => {
		mount({ ...EV, charge: '20', amount: '5', fuelType: 'Electric' });
		expect(screen.getByText('Price per kWh:').parentElement).toHaveTextContent('0.250');
	});

	test('omits the price per kWh without a charge', () => {
		mount({ ...EV, amount: '5' });
		expect(screen.queryByText(/Price per/)).toBeNull();
	});
});

describe('hybrid toggle', () => {
	test('clicking the active mode keeps the typed volume', async () => {
		const section = mount({ ...HYBRID, volume: '12', fuelType: '87 (Regular)' });
		await fireEvent.click(screen.getByRole('button', { name: 'Fuel' }));
		expect(section.form).toMatchObject({ volume: '12', fuelType: '87 (Regular)' });
		expect(screen.getByText('Fuel Details')).toBeInTheDocument();
	});
});

describe('efficiency readout', () => {
	test('is hidden when the calculation is not shown', () => {
		mount({ calculatedMpg: 30 });
		expect(screen.queryByText(/Calculated:/)).toBeNull();
	});

	test('is hidden when there is no calculated figure', () => {
		mount({ showMpgCalculation: true });
		expect(screen.queryByText(/Calculated:/)).toBeNull();
	});

	test('a low MPG suggests a maintenance check', () => {
		mount({ showMpgCalculation: true, calculatedMpg: 12 });
		expect(screen.getByText(/Calculated: 12/)).toHaveTextContent('mi/gal');
		expect(screen.getByText(/Low fuel efficiency/)).toBeInTheDocument();
	});

	test('a high MPG is called out as excellent', () => {
		mount({ showMpgCalculation: true, calculatedMpg: 55, distanceUnit: 'kilometers' });
		expect(screen.getByText(/Calculated: 55/)).toHaveTextContent('km/gal');
		expect(screen.getByText(/Excellent fuel efficiency/)).toBeInTheDocument();
	});

	test('an ordinary MPG shows the figure without a verdict', () => {
		const section = mount({ showMpgCalculation: true, calculatedMpg: 30 });
		const readout = screen.getByText(/Calculated: 30/).closest('div')!.parentElement!;
		expect(within(readout).queryByText(/efficiency/)).toBeNull();
		expect(section.container).not.toHaveTextContent('Excellent');
	});

	test('an MPG figure is not shown while charging', () => {
		mount({ ...EV, showMpgCalculation: true, calculatedMpg: 30 });
		expect(screen.queryByText(/Calculated:/)).toBeNull();
	});

	test('a low electric efficiency suggests checking driving conditions', () => {
		mount({ ...EV, showMpgCalculation: true, calculatedEfficiency: 1.5 });
		expect(screen.getByText(/Calculated: 1.5/)).toHaveTextContent('mi/kWh');
		expect(screen.getByText(/Low efficiency - check driving conditions/)).toBeInTheDocument();
	});

	test('a high electric efficiency is called out as excellent', () => {
		mount({ ...EV, showMpgCalculation: true, calculatedEfficiency: 4.5 });
		expect(screen.getByText(/Excellent efficiency!/)).toBeInTheDocument();
	});

	test('an ordinary electric efficiency shows the figure without a verdict', () => {
		const section = mount({ ...EV, showMpgCalculation: true, calculatedEfficiency: 3 });
		expect(screen.getByText(/Calculated: 3/)).toBeInTheDocument();
		expect(section.container).not.toHaveTextContent('Excellent');
		expect(section.container).not.toHaveTextContent('Low efficiency');
	});

	test('an electric efficiency is not shown in fuel mode', () => {
		mount({ showMpgCalculation: true, calculatedEfficiency: 3 });
		expect(screen.queryByText(/Calculated:/)).toBeNull();
	});
});

describe('missed fill-up', () => {
	test('checking the box marks the previous fill-up as missed', async () => {
		const section = mount();
		await fireEvent.click(screen.getByRole('checkbox'));
		expect(section.form.missedFillup).toBe(true);
	});
});
