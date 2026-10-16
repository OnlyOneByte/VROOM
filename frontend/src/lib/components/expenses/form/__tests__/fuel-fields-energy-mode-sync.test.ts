/**
 * FuelFieldsSection's energy mode must agree with the SELECTED VEHICLE's capability props AND with
 * `fuelType`, because those two decide different halves of one screen:
 *   - the mode decides which input is RENDERED (volume in fuel mode, charge in charging mode);
 *   - `fuelType` decides which input is REQUIRED (ExpenseForm's showVolumeField/showChargeField and
 *     expense-form-validation read formData.fuelType — never the mode).
 * Disagreement therefore shows up as one of two user-visible failures: the required field is HIDDEN
 * (Save does nothing, with an error the user cannot see or clear), or the wrong unit is written
 * (gallons plus an octane rating saved against an EV — nothing downstream rejects that).
 *
 * The third thing the section must never do is rewrite a value it was handed. `fuelType` is optional
 * on this form and real rows store it empty (every Fuelio-imported fill-up does), so "the field is
 * blank" is not permission to fill it in — only "the form carries no energy values at all" is.
 *
 * Coverage comes in two layers:
 *   - the exported decision functions, driven directly over single decisions;
 *   - the MOUNTED component, driven the way ExpenseForm drives it (vehicle objects reassigned under
 *     a live section, real clicks, real inputs), which is the only way to cover the `$effect` that
 *     wires the decision to the bound props.
 */

import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import FuelFieldsSection, {
	DEFAULT_CHARGING_FUEL_TYPE,
	energyModeFields,
	reconcileEnergyMode,
	type EnergyCapabilities,
	type EnergyMode
} from '../FuelFieldsSection.svelte';
import { validateExpenseField } from '../expense-form-validation';

/**
 * Mounting needs svelte's CLIENT entry, and this suite resolves the package's `default` (server)
 * one because vite.config.ts sets no `browser` resolve condition for tests — `mount()` from a bare
 * `svelte` import throws "not available on the server". Components themselves already compile for
 * the DOM here, so pointing the import at the client entry is all that is missing. Both paths below
 * are written `'…' as string` so TypeScript does not try to type svelte's internals (which ship no
 * declarations) while Vite still sees a literal it can resolve.
 */
vi.mock(
	'svelte',
	() => import('../../../../../../node_modules/svelte/src/index-client.js' as string)
);

/**
 * `proxy` is svelte's own `$state` factory. The props below need it because the component's
 * `$effect` must re-run when a capability prop changes, which only happens if the prop getter reads
 * a real signal — and runes are unavailable in a plain `.ts` test module.
 */
const { proxy } = (await import(
	'../../../../../../node_modules/svelte/src/internal/client/index.js' as string
)) as { proxy: <T extends object>(value: T) => T };

const GAS: EnergyCapabilities = { canFuel: true, canCharge: false };
const EV: EnergyCapabilities = { canFuel: false, canCharge: true };
const HYBRID: EnergyCapabilities = { canFuel: true, canCharge: true };
/** Both Energy Tracking switches off — independent switches in VehicleForm, so a real state. */
const NEITHER: EnergyCapabilities = { canFuel: false, canCharge: false };

const ALL_CAPABILITIES = [GAS, EV, HYBRID, NEITHER];

/** The mode's own field — the input the template renders for it. */
const FIELD_FOR_MODE: Record<EnergyMode, 'volume' | 'charge'> = {
	fuel: 'volume',
	charging: 'charge'
};

/**
 * Which energy field the REAL validator demands of a fuel expense whose volume and charge are both
 * still blank. Exactly one is required at a time, and `fuelType` alone selects it.
 */
function requiredEnergyField(fuelType: string): 'volume' | 'charge' {
	const ctx = {
		category: 'fuel',
		vehicle: null,
		volumeUnit: 'gallons_us' as const,
		chargeUnit: 'kwh' as const,
		allVehicleExpenses: [],
		formData: { volume: '', charge: '', fuelType } as Record<string, string | string[]>
	};
	const volumeError = validateExpenseField('volume', ctx);
	const chargeError = validateExpenseField('charge', ctx);
	if (!volumeError === !chargeError) {
		throw new Error(`expected exactly one required energy field for fuelType "${fuelType}"`);
	}
	return volumeError ? 'volume' : 'charge';
}

interface DecisionInput {
	mode: EnergyMode;
	seen: EnergyCapabilities | null;
	caps: EnergyCapabilities;
	fuelType: string;
	volume: string;
	charge: string;
}

/** A single reconcile decision. Defaults describe an untouched form opened in fuel mode. */
function decide(over: Partial<DecisionInput> & { caps: EnergyCapabilities }) {
	return reconcileEnergyMode({
		mode: 'fuel',
		seen: null,
		fuelType: '',
		volume: '',
		charge: '',
		...over
	});
}

describe('energyModeFields', () => {
	test('entering charging clears volume, keeps charge, and names an electric fuelType', () => {
		expect(energyModeFields('charging', { volume: '12.5', charge: '40' })).toEqual({
			volume: '',
			charge: '40',
			fuelType: DEFAULT_CHARGING_FUEL_TYPE
		});
	});

	test('entering fuel clears charge, keeps volume, and clears the electric fuelType', () => {
		expect(energyModeFields('fuel', { volume: '12.5', charge: '40' })).toEqual({
			volume: '12.5',
			charge: '',
			fuelType: ''
		});
	});

	test('each mode leaves the REQUIRED field equal to the mode’s own field', () => {
		for (const mode of ['fuel', 'charging'] as EnergyMode[]) {
			const form = energyModeFields(mode, { volume: '', charge: '' });
			expect(requiredEnergyField(form.fuelType)).toBe(FIELD_FOR_MODE[mode]);
		}
	});
});

describe('reconcileEnergyMode — first run (no capabilities seen yet)', () => {
	test('a gas-only vehicle with an empty form opens in fuel mode, untouched', () => {
		expect(decide({ caps: GAS })).toEqual({
			mode: 'fuel',
			applyFields: null,
			seedFuelType: null
		});
	});

	test('a charge-only vehicle with an empty form opens in charging mode AND seeds the fuelType', () => {
		expect(decide({ caps: EV })).toEqual({
			mode: 'charging',
			applyFields: null,
			seedFuelType: DEFAULT_CHARGING_FUEL_TYPE
		});
	});

	test('a hybrid opens in fuel mode (the toggle offers charging)', () => {
		expect(decide({ caps: HYBRID })).toEqual({
			mode: 'fuel',
			applyFields: null,
			seedFuelType: null
		});
	});

	test('a vehicle tracking NEITHER opens in fuel mode, which keeps volume visible', () => {
		// Charging mode with an empty fuelType would require the hidden volume field — unsatisfiable.
		expect(decide({ caps: NEITHER })).toEqual({
			mode: 'fuel',
			applyFields: null,
			seedFuelType: null
		});
	});

	test('a loaded electric fuelType wins over the capabilities and clears nothing', () => {
		for (const caps of ALL_CAPABILITIES) {
			expect(decide({ caps, fuelType: 'Level 2 (AC)', charge: '38.4' })).toEqual({
				mode: 'charging',
				applyFields: null,
				seedFuelType: null
			});
		}
	});

	test('a loaded gas fuelType wins too — even on a charge-only vehicle', () => {
		for (const caps of ALL_CAPABILITIES) {
			expect(decide({ mode: 'charging', caps, fuelType: '91 (Premium)', volume: '11.2' })).toEqual({
				mode: 'fuel',
				applyFields: null,
				seedFuelType: null
			});
		}
	});

	test('a volume with no fuelType is left alone on every vehicle, in the mode that requires it', () => {
		// A Fuelio-imported fill-up: `fuel_type` is blank, so seeding one would retype the row as a
		// charge and hide the gallons it was storing.
		for (const caps of ALL_CAPABILITIES) {
			expect(decide({ caps, volume: '12.5' })).toEqual({
				mode: 'fuel',
				applyFields: null,
				seedFuelType: null
			});
		}
	});

	test('a charge with no fuelType is left alone too, in the mode that requires it', () => {
		for (const caps of ALL_CAPABILITIES) {
			expect(decide({ caps, charge: '38.4' })).toEqual({
				mode: 'fuel',
				applyFields: null,
				seedFuelType: null
			});
		}
	});
});

describe('reconcileEnergyMode — a re-run with the SAME capabilities decides nothing', () => {
	// ExpenseForm reassigns `vehicle` more than once per load, and the child's capability props are
	// plain getters over that state source, so the effect re-runs with identical booleans.
	test('every capability pair, in either mode, is a clean no-op', () => {
		for (const caps of ALL_CAPABILITIES) {
			for (const mode of ['fuel', 'charging'] as EnergyMode[]) {
				for (const fuelType of ['', 'Electric', '87 (Regular)']) {
					expect(decide({ mode, seen: { ...caps }, caps, fuelType })).toEqual({
						mode,
						applyFields: null,
						seedFuelType: null
					});
				}
			}
		}
	});

	test('a mode the user chose on a hybrid survives the re-run', () => {
		expect(
			decide({
				mode: 'charging',
				seen: HYBRID,
				caps: HYBRID,
				fuelType: DEFAULT_CHARGING_FUEL_TYPE
			})
		).toEqual({ mode: 'charging', applyFields: null, seedFuelType: null });
	});
});

describe('reconcileEnergyMode — clamp on a real capability change', () => {
	test('fuel mode on a vehicle that can only charge moves to charging and re-applies fields', () => {
		expect(decide({ seen: GAS, caps: EV, volume: '11.2' })).toEqual({
			mode: 'charging',
			applyFields: 'charging',
			seedFuelType: null
		});
	});

	test('charging mode on a vehicle that can only fuel moves to fuel and re-applies fields', () => {
		expect(decide({ mode: 'charging', seen: EV, caps: GAS, fuelType: 'Electric' })).toEqual({
			mode: 'fuel',
			applyFields: 'fuel',
			seedFuelType: null
		});
	});

	test('a still-supported mode is left alone when the OTHER capability appears', () => {
		expect(decide({ seen: GAS, caps: HYBRID })).toEqual({
			mode: 'fuel',
			applyFields: null,
			seedFuelType: null
		});
		expect(decide({ mode: 'charging', seen: EV, caps: HYBRID, fuelType: 'Electric' })).toEqual({
			mode: 'charging',
			applyFields: null,
			seedFuelType: null
		});
	});

	test('with NEITHER capability there is no supported mode to clamp onto, so nothing moves', () => {
		expect(decide({ seen: GAS, caps: NEITHER })).toEqual({
			mode: 'fuel',
			applyFields: null,
			seedFuelType: null
		});
		expect(decide({ mode: 'charging', seen: EV, caps: NEITHER, fuelType: 'Electric' })).toEqual({
			mode: 'charging',
			applyFields: null,
			seedFuelType: null
		});
	});
});

/** What ExpenseForm binds into the section and would carry into a save. */
interface BoundForm {
	volume: string;
	charge: string;
	fuelType: string;
	missedFillup: boolean;
}

interface MountedSection {
	/** Live view of the bound props — the component writes straight into these. */
	form: BoundForm;
	/** 'Fuel Details' or 'Charging Details' — the mode, as the user reads it. */
	heading(): string;
	/** The energy input on screen. Exactly one of volume/charge is ever rendered. */
	visibleEnergyField(): 'volume' | 'charge';
	visibleEnergyValue(): string;
	fuelTypeTrigger(): string;
	/** Labels of the mode-toggle buttons — the section only offers them when both modes apply. */
	modeToggleLabels(): string[];
	/** Type into whichever energy input is on screen. */
	type(value: string): Promise<void>;
	/** Click the fuel/charging toggle (hybrids only). */
	toggle(mode: EnergyMode): Promise<void>;
	/** `vehicle = await vehicleApi.getVehicle(...)` — a NEW object with the given capabilities. */
	selectVehicle(caps: EnergyCapabilities): void;
	/** The same capabilities re-emitted as a new object, as a second load of one edit does. */
	reemitVehicle(): void;
}

function mountSection(caps: EnergyCapabilities, loaded: Partial<BoundForm> = {}): MountedSection {
	const state = proxy({
		vehicle: { ...caps },
		volume: '',
		charge: '',
		fuelType: '',
		missedFillup: false,
		...loaded
	});
	// Capability props as getters over the `vehicle` object, and the four bound fields as
	// accessors: exactly what ExpenseForm's `trackFuel={vehicle.trackFuel}` and `bind:volume`
	// compile to, so the section sees the real prop protocol.
	const props = {
		get trackFuel() {
			return state.vehicle.canFuel;
		},
		get trackCharging() {
			return state.vehicle.canCharge;
		},
		get volume() {
			return state.volume;
		},
		set volume(value: string) {
			state.volume = value;
		},
		get charge() {
			return state.charge;
		},
		set charge(value: string) {
			state.charge = value;
		},
		get fuelType() {
			return state.fuelType;
		},
		set fuelType(value: string) {
			state.fuelType = value;
		},
		get missedFillup() {
			return state.missedFillup;
		},
		set missedFillup(value: boolean) {
			state.missedFillup = value;
		},
		amount: '40.00',
		volumeUnit: 'gallons_us' as const,
		chargeUnit: 'kwh' as const,
		distanceUnit: 'miles' as const,
		calculatedMpg: null,
		calculatedEfficiency: null,
		showMpgCalculation: false,
		errors: {} as Record<string, string | undefined>,
		touched: {} as Record<string, boolean>,
		onBlur: () => {},
		onMileageChange: () => {}
	};
	const { container } = render(FuelFieldsSection, props);

	const energyInput = () => {
		const volume = container.querySelector<HTMLInputElement>('#volume');
		const charge = container.querySelector<HTMLInputElement>('#charge');
		if (!volume === !charge) {
			throw new Error('expected exactly one of the volume/charge inputs to be rendered');
		}
		return (volume ?? charge)!;
	};

	const modeToggleLabels = () =>
		[...container.querySelectorAll('button')]
			.map(button => button.textContent?.trim() ?? '')
			.filter(label => label === 'Fuel' || label === 'Charging');

	return {
		form: state,
		heading: () => container.querySelector('h3')?.textContent?.trim() ?? '',
		visibleEnergyField: () => energyInput().id as 'volume' | 'charge',
		visibleEnergyValue: () => energyInput().value,
		fuelTypeTrigger: () => container.querySelector('#fuelType')?.textContent?.trim() ?? '',
		modeToggleLabels,
		type: async (value: string) => {
			await fireEvent.input(energyInput(), { target: { value } });
		},
		toggle: async (mode: EnergyMode) => {
			const label = mode === 'fuel' ? 'Fuel' : 'Charging';
			const button = [...container.querySelectorAll('button')].find(
				candidate => candidate.textContent?.trim() === label
			);
			if (!button) throw new Error(`no ${label} toggle button on screen`);
			await fireEvent.click(button);
		},
		selectVehicle: (next: EnergyCapabilities) => {
			flushSync(() => {
				state.vehicle = { ...next };
			});
		},
		reemitVehicle: () => {
			flushSync(() => {
				state.vehicle = { ...state.vehicle };
			});
		}
	};
}

const HEADING_FOR_MODE: Record<EnergyMode, string> = {
	fuel: 'Fuel Details',
	charging: 'Charging Details'
};

/** The agreement the whole component exists to hold: the required field is the one on screen. */
function expectRequiredFieldVisible(section: MountedSection) {
	expect(requiredEnergyField(section.form.fuelType)).toBe(section.visibleEnergyField());
}

describe('mounted: opening the form', () => {
	test('a new entry on a charge-only vehicle shows kWh and seeds the electric fuelType', () => {
		const section = mountSection(EV);

		expect(section.heading()).toBe(HEADING_FOR_MODE.charging);
		expect(section.visibleEnergyField()).toBe('charge');
		// Without the seed the required field is `volume`, which charging mode hides: Save would
		// fail on an error with nowhere to appear.
		expect(section.form.fuelType).toBe(DEFAULT_CHARGING_FUEL_TYPE);
		expectRequiredFieldVisible(section);
	});

	test('a new entry on a gas vehicle shows gallons and leaves fuelType for the user', () => {
		const section = mountSection(GAS);

		expect(section.heading()).toBe(HEADING_FOR_MODE.fuel);
		expect(section.visibleEnergyField()).toBe('volume');
		expect(section.form.fuelType).toBe('');
		expect(section.fuelTypeTrigger()).toBe('Select fuel type (optional)');
		expectRequiredFieldVisible(section);
	});

	test('an imported fill-up with no fuelType keeps its gallons on a charge-only vehicle', () => {
		// The Fuelio importer stores every fill-up with an empty fuel_type, and the user may since
		// have turned that vehicle's fuel tracking off. Opening the row must not retype it.
		const section = mountSection(EV, { volume: '12.5' });

		expect(section.heading()).toBe(HEADING_FOR_MODE.fuel);
		expect(section.visibleEnergyField()).toBe('volume');
		expect(section.visibleEnergyValue()).toBe('12.5');
		expect(section.form).toMatchObject({ volume: '12.5', charge: '', fuelType: '' });
		expectRequiredFieldVisible(section);
	});

	test('a loaded charge with no fuelType is left alone too, on the vehicle that invites seeding', () => {
		// The same rule from the other side: a stored quantity of EITHER kind is data, so the
		// charge-only vehicle gets no seed here either. With no fuelType the validator requires
		// volume, so fuel mode is the only mode that keeps the required field on screen.
		const section = mountSection(EV, { charge: '38.4' });

		expect(section.heading()).toBe(HEADING_FOR_MODE.fuel);
		expect(section.form).toMatchObject({ volume: '', charge: '38.4', fuelType: '' });
		expectRequiredFieldVisible(section);
	});

	test('a loaded electric charge opens in charging mode with its fuelType untouched', () => {
		const section = mountSection(GAS, { charge: '38.4', fuelType: 'DC Fast Charging' });

		expect(section.heading()).toBe(HEADING_FOR_MODE.charging);
		expect(section.visibleEnergyValue()).toBe('38.4');
		expect(section.form).toMatchObject({
			volume: '',
			charge: '38.4',
			fuelType: 'DC Fast Charging'
		});
		expectRequiredFieldVisible(section);
	});

	test('the vehicle being re-emitted during one load rewrites nothing', () => {
		// ExpenseForm's onMount and its vehicleId `$effect` both call loadVehicle(), so the section
		// sees the same capabilities arrive twice as different objects.
		const section = mountSection(GAS, { volume: '12.5', fuelType: '87 (Regular)' });

		section.reemitVehicle();
		section.reemitVehicle();

		expect(section.heading()).toBe(HEADING_FOR_MODE.fuel);
		expect(section.form).toMatchObject({
			volume: '12.5',
			charge: '',
			fuelType: '87 (Regular)'
		});
		expectRequiredFieldVisible(section);
	});

	test('a seeded new entry stays seeded across the re-emission', () => {
		const section = mountSection(EV);

		section.reemitVehicle();

		expect(section.heading()).toBe(HEADING_FOR_MODE.charging);
		expect(section.form.fuelType).toBe(DEFAULT_CHARGING_FUEL_TYPE);
		expectRequiredFieldVisible(section);
	});
});

describe('mounted: switching vehicle under a live form', () => {
	test('swapping a gas car for an EV drops the gallons instead of saving them as a charge', async () => {
		const section = mountSection(GAS);
		await section.type('11.2');

		section.selectVehicle(EV);

		expect(section.heading()).toBe(HEADING_FOR_MODE.charging);
		expect(section.visibleEnergyField()).toBe('charge');
		expect(section.form.volume).toBe('');
		expect(section.form.fuelType).toBe(DEFAULT_CHARGING_FUEL_TYPE);
		expectRequiredFieldVisible(section);
	});

	test('swapping an EV for a gas car drops the kWh and the electric fuelType', async () => {
		const section = mountSection(EV);
		await section.type('38.4');

		section.selectVehicle(GAS);

		expect(section.heading()).toBe(HEADING_FOR_MODE.fuel);
		expect(section.visibleEnergyField()).toBe('volume');
		expect(section.form.charge).toBe('');
		expect(section.form.fuelType).toBe('');
		expectRequiredFieldVisible(section);
	});

	test('swapping in a vehicle that tracks neither keeps the entry as typed', async () => {
		const section = mountSection(GAS);
		await section.type('9');

		section.selectVehicle(NEITHER);

		expect(section.heading()).toBe(HEADING_FOR_MODE.fuel);
		// `bind:value` on a number input hands the parent a number, not the typed string.
		expect(String(section.form.volume)).toBe('9');
		expectRequiredFieldVisible(section);
	});

	test('every pair of vehicles leaves the required field on screen', () => {
		for (const first of ALL_CAPABILITIES) {
			for (const second of ALL_CAPABILITIES) {
				const section = mountSection(first);
				section.reemitVehicle();
				section.selectVehicle(second);
				expectRequiredFieldVisible(section);
			}
		}
	});
});

describe('mounted: the hybrid toggle', () => {
	test('only a vehicle tracking both energies offers the toggle', () => {
		expect(mountSection(HYBRID).modeToggleLabels()).toEqual(['Fuel', 'Charging']);
		// One-energy vehicles have no way back, so the mode they open in has to be the right one.
		expect(mountSection(GAS).modeToggleLabels()).toEqual([]);
		expect(mountSection(EV).modeToggleLabels()).toEqual([]);
		expect(mountSection(NEITHER).modeToggleLabels()).toEqual([]);
	});

	test('switching to charging clears the gallons and names an electric fuelType', async () => {
		const section = mountSection(HYBRID);
		await section.type('11.2');

		await section.toggle('charging');

		expect(section.heading()).toBe(HEADING_FOR_MODE.charging);
		expect(section.form.volume).toBe('');
		expect(section.form.fuelType).toBe(DEFAULT_CHARGING_FUEL_TYPE);
		expectRequiredFieldVisible(section);
	});

	test('switching back to fuel clears the kWh and the electric fuelType', async () => {
		const section = mountSection(HYBRID);
		await section.toggle('charging');
		await section.type('38.4');

		await section.toggle('fuel');

		expect(section.heading()).toBe(HEADING_FOR_MODE.fuel);
		expect(section.form.charge).toBe('');
		expect(section.form.fuelType).toBe('');
		expectRequiredFieldVisible(section);
	});

	test('the mode the user picked survives the vehicle being re-emitted', async () => {
		const section = mountSection(HYBRID);
		await section.toggle('charging');
		await section.type('38.4');

		section.reemitVehicle();

		expect(section.heading()).toBe(HEADING_FOR_MODE.charging);
		expect(section.visibleEnergyValue()).toBe('38.4');
		expectRequiredFieldVisible(section);
	});
});

// The seeded fuelType has to be one the charging dropdown offers, or the user cannot pick it back
// after clearing it. CHARGING_TYPE_OPTIONS lives in the instance script, which no import reaches,
// and the options only render into the DOM once the select is opened.
test('the charging dropdown offers the fuelType the reconciler seeds', () => {
	const source = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '..', 'FuelFieldsSection.svelte'),
		'utf-8'
	);
	const start = source.indexOf('const CHARGING_TYPE_OPTIONS');
	expect(start).toBeGreaterThan(-1);
	const options = source.slice(start, source.indexOf('];', start));
	expect(options).toContain(`'${DEFAULT_CHARGING_FUEL_TYPE}'`);
});
