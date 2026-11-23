import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import type {
	CreateTermRequest,
	InsurancePolicy,
	UpdateTermRequest,
	Vehicle
} from '#lib/types/index.ts';
import { dateOnlyToISO } from '#lib/utils/formatters.ts';
import { VEHICLES, makePolicy, makeTerm, settle } from './insurance-fixtures.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const currency = vi.hoisted(() => ({ unit: 'USD' }));
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		get settings() {
			return { currencyUnit: currency.unit };
		}
	}
}));

const gotoDynamic = vi.fn<(url: string) => void>();
vi.mock('#lib/utils/navigation.ts', () => ({ gotoDynamic: (url: string) => gotoDynamic(url) }));

const showError = vi.fn<(message: string) => void>();
const showSuccess = vi.fn<(message: string) => void>();
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: {
		showError: (message: string) => showError(message),
		showSuccess: (message: string) => showSuccess(message)
	}
}));

const getVehicles = vi.fn<() => Promise<Vehicle[]>>();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
}));

const getPolicy = vi.fn<(id: string) => Promise<InsurancePolicy>>();
const addTerm = vi.fn<(policyId: string, term: CreateTermRequest) => Promise<InsurancePolicy>>();
const updateTerm =
	vi.fn<(policyId: string, termId: string, term: UpdateTermRequest) => Promise<InsurancePolicy>>();
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getPolicy: (id: string) => getPolicy(id),
		addTerm: (policyId: string, term: CreateTermRequest) => addTerm(policyId, term),
		updateTerm: (policyId: string, termId: string, term: UpdateTermRequest) =>
			updateTerm(policyId, termId, term)
	}
}));

vi.mock('#lib/components/common/date-picker.svelte', async () => ({
	default: (await import('./DatePickerStub.svelte')).default
}));

const InsuranceTermForm = (await import('../form/InsuranceTermForm.svelte')).default;

const FULL_TERM = makeTerm({
	id: 't1',
	startDate: dateOnlyToISO('2025-06-01'),
	endDate: dateOnlyToISO('2026-06-01'),
	policyNumber: 'POL-1',
	coverageDescription: 'Comprehensive',
	deductibleAmount: 500,
	coverageLimit: 50000,
	agentName: 'Sam',
	agentPhone: '555-0101',
	agentEmail: 'sam@example.com',
	totalCost: 1200,
	monthlyCost: 100,
	premiumFrequency: 'Annual',
	paymentAmount: 1200
});

const POLICY = makePolicy({
	id: 'p1',
	company: 'Acme Mutual',
	vehicleIds: ['v1', 'v2'],
	terms: [FULL_TERM],
	termVehicleCoverage: [
		{ termId: 't1', vehicleId: 'v2' },
		{ termId: 'other', vehicleId: 'v1' }
	]
});

async function mount(props: Record<string, unknown> = {}) {
	const result = render(InsuranceTermForm, { props: { policyId: 'p1', ...props } });
	await settle();
	return result;
}

function field(id: string): HTMLInputElement | HTMLTextAreaElement {
	const el = document.getElementById(id);
	if (!el) throw new Error(`missing field #${id}`);
	return el as HTMLInputElement | HTMLTextAreaElement;
}

async function type(id: string, value: string) {
	await fireEvent.input(field(id), { target: { value } });
}

async function clickSave(name: RegExp = /Save Term/) {
	await fireEvent.click(screen.getByRole('button', { name }));
	await settle();
}

async function fillDatesAndVehicle() {
	await type('start-date', '2026-07-01');
	await type('end-date', '2027-07-01');
	await fireEvent.click(screen.getByRole('checkbox', { name: 'Daily' }));
}

beforeEach(() => {
	vi.clearAllMocks();
	getVehicles.mockResolvedValue(VEHICLES);
	getPolicy.mockResolvedValue(POLICY);
	addTerm.mockResolvedValue(POLICY);
	updateTerm.mockResolvedValue(POLICY);
});

afterEach(() => {
	cleanup();
	currency.unit = 'USD';
});

describe('InsuranceTermForm amount inputs follow the currency', () => {
	const amountIds = [
		'total-cost',
		'monthly-cost',
		'payment-amount',
		'deductible',
		'coverage-limit'
	];

	test('a JPY user steps every amount in whole yen', async () => {
		currency.unit = 'JPY';
		await mount();
		for (const id of amountIds) expect(field(id)).toHaveAttribute('step', '1');
	});

	test('a USD user keeps the cents step', async () => {
		await mount();
		for (const id of amountIds) expect(field(id)).toHaveAttribute('step', '0.01');
	});
});

describe('InsuranceTermForm add mode', () => {
	test('shows the add title with the policy company and empty fields', async () => {
		await mount();
		expect(getPolicy).toHaveBeenCalledWith('p1');
		expect(screen.getByRole('heading', { name: 'Add Term' })).toBeInTheDocument();
		expect(screen.getByText('Acme Mutual')).toBeInTheDocument();
		expect(field('start-date')).toHaveValue('');
		expect(field('policy-number')).toHaveValue('');
		expect(screen.getByRole('checkbox', { name: 'Daily' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	test('shows the empty-vehicle hint when the user has no vehicles', async () => {
		getVehicles.mockResolvedValue([]);
		await mount();
		expect(
			screen.getByText('Add a vehicle first to cover it under this term.')
		).toBeInTheDocument();
		expect(screen.queryByRole('checkbox')).toBeNull();
	});

	test('submitting an empty form flags dates and vehicles and sends nothing', async () => {
		await mount();
		await clickSave();
		expect(screen.getByText('Start date is required')).toBeInTheDocument();
		expect(screen.getByText('End date is required')).toBeInTheDocument();
		expect(screen.getByText('At least one vehicle is required')).toBeInTheDocument();
		expect(addTerm).not.toHaveBeenCalled();
	});

	test('the even split preview lists vehicles in the order they were ticked, as the saved split does', async () => {
		await mount();
		await type('start-date', '2026-07-01');
		await type('end-date', '2027-07-01');
		await fireEvent.click(screen.getByRole('checkbox', { name: '2019 Honda Civic' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Daily' }));
		await type('total-cost', '10.01');
		await settle();

		const rowText = (name: string) =>
			screen.getAllByText(name).at(-1)?.parentElement?.textContent?.replace(/\s+/g, ' ').trim();
		expect(rowText('2019 Honda Civic')).toBe('2019 Honda Civic $5.01');
		expect(rowText('Daily')).toBe('Daily $5.00');

		await clickSave();
		expect(addTerm.mock.calls[0]?.[1].vehicleCoverage?.vehicleIds).toEqual(['v2', 'v1']);
	});

	test('offers no split method, so the even preview is what gets saved', async () => {
		await mount();
		await fillDatesAndVehicle();
		await fireEvent.click(screen.getByRole('checkbox', { name: '2019 Honda Civic' }));
		await type('total-cost', '1000');
		await settle();

		expect(
			screen.getByText('The premium is split evenly between the covered vehicles.')
		).toBeInTheDocument();
		for (const label of ['Even', 'Fixed $', '%']) {
			expect(screen.queryByRole('button', { name: label })).toBeNull();
		}
		expect(screen.queryByRole('spinbutton', { name: /Percentage for|Amount for/ })).toBeNull();
		const rowText = (name: string) =>
			screen.getAllByText(name).at(-1)?.parentElement?.textContent?.replace(/\s+/g, ' ').trim();
		expect(rowText('Daily')).toBe('Daily $500.00');
		expect(rowText('2019 Honda Civic')).toBe('2019 Honda Civic $500.00');

		await clickSave();
		expect(addTerm.mock.calls[0]?.[1].vehicleCoverage).toStrictEqual({ vehicleIds: ['v1', 'v2'] });
	});

	test('a monthly-only term previews the monthly cost times its billed months, as the API charges', async () => {
		await mount();
		await type('start-date', '2026-07-01');
		await type('end-date', '2027-01-01');
		await fireEvent.click(screen.getByRole('checkbox', { name: '2019 Honda Civic' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Daily' }));
		await type('monthly-cost', '100.01');
		await settle();

		expect(
			screen.getByText(
				'The premium is the monthly cost for each billed month of the term, split evenly between the covered vehicles.'
			)
		).toBeInTheDocument();
		const rowText = (name: string) =>
			screen.getAllByText(name).at(-1)?.parentElement?.textContent?.replace(/\s+/g, ' ').trim();
		expect(rowText('2019 Honda Civic')).toBe('2019 Honda Civic $300.03');
		expect(rowText('Daily')).toBe('Daily $300.03');
		expect(screen.getByText('$600.06')).toBeInTheDocument();
	});

	test('rejects an end date that is not after the start date', async () => {
		await mount();
		await type('start-date', '2026-07-01');
		await type('end-date', '2026-06-30');
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Daily' }));
		await clickSave();
		expect(screen.getByText('End date must be after start date')).toBeInTheDocument();
		expect(addTerm).not.toHaveBeenCalled();
	});

	test('rejects negative or non-positive amounts field by field', async () => {
		await mount();
		await fillDatesAndVehicle();
		await type('deductible', '-1');
		await type('coverage-limit', '-1');
		await type('total-cost', '-1');
		await type('monthly-cost', '-1');
		await type('payment-amount', '-1');
		await clickSave();
		expect(screen.getAllByText('Must be positive')).toHaveLength(2);
		expect(screen.getAllByText('Must be non-negative')).toHaveLength(3);
		expect(field('monthly-cost')).toHaveAttribute('aria-invalid', 'true');
		expect(field('payment-amount')).toHaveAttribute('aria-invalid', 'true');
		expect(addTerm).not.toHaveBeenCalled();
	});

	test('omits blank optional fields from the new term', async () => {
		await mount({ returnTo: '/insurance/p1' });
		await fillDatesAndVehicle();
		await clickSave();
		expect(addTerm).toHaveBeenCalledWith('p1', {
			startDate: dateOnlyToISO('2026-07-01'),
			endDate: dateOnlyToISO('2027-07-01'),
			vehicleCoverage: { vehicleIds: ['v1'] }
		});
		expect(showSuccess).toHaveBeenCalledWith('Term added successfully');
		expect(gotoDynamic).toHaveBeenCalledWith('/insurance/p1');
	});

	test('sends entered text trimmed and entered costs as typed', async () => {
		await mount();
		await fillDatesAndVehicle();
		await type('policy-number', ' N-7 ');
		await type('coverage-desc', ' Liability ');
		await type('deductible', '250');
		await type('coverage-limit', '25000');
		await type('agent-name', ' Kim ');
		await type('agent-phone', ' 555 ');
		await type('agent-email', ' kim@example.com ');
		await type('total-cost', '999.99');
		await type('monthly-cost', '83.33');
		await type('payment-amount', '499.5');
		await clickSave();
		expect(addTerm.mock.calls[0]?.[1]).toEqual({
			startDate: dateOnlyToISO('2026-07-01'),
			endDate: dateOnlyToISO('2027-07-01'),
			policyNumber: 'N-7',
			coverageDescription: 'Liability',
			deductibleAmount: 250,
			coverageLimit: 25000,
			agentName: 'Kim',
			agentPhone: '555',
			agentEmail: 'kim@example.com',
			totalCost: 999.99,
			monthlyCost: 83.33,
			paymentAmount: 499.5,
			vehicleCoverage: { vehicleIds: ['v1'] }
		});
	});

	test('toggling a vehicle twice leaves it uncovered', async () => {
		await mount();
		const daily = screen.getByRole('checkbox', { name: 'Daily' });
		await fireEvent.click(daily);
		expect(daily).toHaveAttribute('aria-checked', 'true');
		await fireEvent.click(daily);
		expect(daily).toHaveAttribute('aria-checked', 'false');
	});

	test('an add failure reports the API message and stays on the form', async () => {
		addTerm.mockRejectedValue(new ApiError('This term overlaps another term', 409));
		await mount();
		await fillDatesAndVehicle();
		await clickSave();
		expect(showError).toHaveBeenCalledWith(
			"Couldn't add the term. This term overlaps another term."
		);
		expect(gotoDynamic).not.toHaveBeenCalled();
	});

	test('a non-Error add failure is reported as unknown', async () => {
		addTerm.mockRejectedValue('nope');
		await mount();
		await fillDatesAndVehicle();
		await clickSave();
		expect(showError).toHaveBeenCalledWith(`Couldn't add the term. ${UNEXPECTED_FAILURE_MESSAGE}`);
	});

	test('the save button shows a saving state while the request is pending', async () => {
		addTerm.mockReturnValue(new Promise(() => {}));
		await mount();
		await fillDatesAndVehicle();
		await clickSave();
		expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
		expect(screen.getByRole('button', { name: /Cancel/ })).toBeDisabled();
	});

	test('a save in flight counts as unsaved changes until the form closes', async () => {
		addTerm.mockReturnValue(new Promise(() => {}));
		const { unmount } = await mount();
		await fillDatesAndVehicle();
		expect(hasPendingSave()).toBe(false);

		await clickSave();

		expect(hasPendingSave()).toBe(true);
		unmount();
		expect(hasPendingSave()).toBe(false);
	});

	test('cancel and back return to the returnTo path without saving', async () => {
		await mount({ returnTo: '/vehicles/v1' });
		await fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
		expect(gotoDynamic).toHaveBeenCalledTimes(2);
		expect(gotoDynamic).toHaveBeenCalledWith('/vehicles/v1');
		expect(addTerm).not.toHaveBeenCalled();
	});

	test('a policy that no longer exists is reported and the user is sent back', async () => {
		getPolicy.mockRejectedValue(new ApiError('Policy not found', 404));
		await mount({ returnTo: '/insurance' });
		expect(showError).toHaveBeenCalledWith('That policy no longer exists.');
		expect(gotoDynamic).toHaveBeenCalledWith('/insurance');
	});

	test('a server failure stays on the page with a Retry that reloads the policy', async () => {
		getPolicy.mockRejectedValueOnce(new ApiError('Internal server error', 500));
		await mount({ returnTo: '/insurance' });
		expect(screen.getByText("Couldn't load this policy")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(gotoDynamic).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(getPolicy).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't load this policy")).toBeNull();
	});

	test('shows a spinner while the policy loads', async () => {
		getPolicy.mockReturnValue(new Promise(() => {}));
		const { container } = await mount();
		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(screen.queryByRole('heading')).toBeNull();
	});
});

describe('InsuranceTermForm edit mode', () => {
	test('prefills every field and the covered vehicles from the term', async () => {
		await mount({ termId: 't1' });
		expect(screen.getByRole('heading', { name: 'Edit Term' })).toBeInTheDocument();
		expect(field('start-date')).toHaveValue('2025-06-01');
		expect(field('end-date')).toHaveValue('2026-06-01');
		expect(field('policy-number')).toHaveValue('POL-1');
		expect(field('coverage-desc')).toHaveValue('Comprehensive');
		expect(field('deductible')).toHaveValue(500);
		expect(field('coverage-limit')).toHaveValue(50000);
		expect(field('agent-name')).toHaveValue('Sam');
		expect(field('agent-phone')).toHaveValue('555-0101');
		expect(field('agent-email')).toHaveValue('sam@example.com');
		expect(field('total-cost')).toHaveValue(1200);
		expect(field('monthly-cost')).toHaveValue(100);
		expect(field('payment-amount')).toHaveValue(1200);
		expect(document.getElementById('premium-frequency')).toHaveTextContent('Annual');
		expect(screen.getByRole('checkbox', { name: '2019 Honda Civic' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		expect(screen.getByRole('checkbox', { name: 'Daily' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		expect(screen.getByRole('button', { name: /Update Term/ })).toBeInTheDocument();
	});

	test('an unknown term id reports and navigates back', async () => {
		await mount({ termId: 'missing', returnTo: '/insurance/p1' });
		expect(showError).toHaveBeenCalledWith('That term no longer exists.');
		expect(gotoDynamic).toHaveBeenCalledWith('/insurance/p1');
	});

	test('sends null for fields the user cleared so the server drops them', async () => {
		getPolicy.mockResolvedValue(
			makePolicy({
				terms: [
					makeTerm({
						id: 't1',
						startDate: dateOnlyToISO('2025-06-01'),
						endDate: dateOnlyToISO('2026-06-01'),
						policyNumber: 'POL-1'
					})
				],
				termVehicleCoverage: [{ termId: 't1', vehicleId: 'v1' }]
			})
		);
		await mount({ termId: 't1' });
		await type('policy-number', '');
		await clickSave(/Update Term/);
		expect(updateTerm).toHaveBeenCalledWith('p1', 't1', {
			startDate: dateOnlyToISO('2025-06-01'),
			endDate: dateOnlyToISO('2026-06-01'),
			policyNumber: null,
			coverageDescription: null,
			deductibleAmount: null,
			coverageLimit: null,
			agentName: null,
			agentPhone: null,
			agentEmail: null,
			totalCost: null,
			monthlyCost: null,
			premiumFrequency: null,
			paymentAmount: null,
			vehicleCoverage: { vehicleIds: ['v1'] }
		});
		expect(showSuccess).toHaveBeenCalledWith('Term updated successfully');
		expect(gotoDynamic).toHaveBeenCalledWith('/insurance');
	});

	test('sends the edited values with the prefilled ones on update', async () => {
		await mount({ termId: 't1' });
		await type('agent-name', 'Alex');
		await clickSave(/Update Term/);
		const body = updateTerm.mock.calls[0]?.[2];
		expect(body?.agentName).toBe('Alex');
		expect(body?.policyNumber).toBe('POL-1');
		expect(body?.premiumFrequency).toBe('Annual');
		expect(body?.totalCost).toBe(1200);
		expect(body?.vehicleCoverage?.vehicleIds).toEqual(['v2']);
	});

	test('an update failure reports with the update verb', async () => {
		updateTerm.mockRejectedValue(new ApiError('Internal server error', 500));
		await mount({ termId: 't1' });
		await clickSave(/Update Term/);
		expect(showError).toHaveBeenCalledWith(`Couldn't update the term. ${SERVER_FAILURE_MESSAGE}`);
	});
});

describe('InsuranceTermForm renew mode', () => {
	test('copies the previous term details but leaves the dates blank', async () => {
		await mount({ renewFrom: 't1' });
		expect(screen.getByRole('heading', { name: 'Renew Term' })).toBeInTheDocument();
		expect(field('start-date')).toHaveValue('');
		expect(field('end-date')).toHaveValue('');
		expect(field('policy-number')).toHaveValue('POL-1');
		expect(field('agent-email')).toHaveValue('sam@example.com');
		expect(screen.getByRole('checkbox', { name: '2019 Honda Civic' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
	});

	test('renewing posts a new term and confirms the renewal', async () => {
		await mount({ renewFrom: 't1' });
		await type('start-date', '2026-06-01');
		await type('end-date', '2027-06-01');
		await clickSave();
		const [policyId, body] = addTerm.mock.calls[0] ?? [];
		expect(policyId).toBe('p1');
		expect(body?.startDate).toBe(dateOnlyToISO('2026-06-01'));
		expect(body?.policyNumber).toBe('POL-1');
		expect(body?.premiumFrequency).toBe('Annual');
		expect(body?.vehicleCoverage.vehicleIds).toEqual(['v2']);
		expect(showSuccess).toHaveBeenCalledWith('Term renewed successfully');
	});

	test('an unknown renewFrom id falls back to an empty add form', async () => {
		await mount({ renewFrom: 'missing' });
		expect(screen.getByRole('heading', { name: 'Renew Term' })).toBeInTheDocument();
		expect(field('policy-number')).toHaveValue('');
		expect(showError).not.toHaveBeenCalled();
	});
});
