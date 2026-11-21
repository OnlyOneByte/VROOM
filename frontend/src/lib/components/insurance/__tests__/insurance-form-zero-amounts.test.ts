import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type {
	CreatePolicyRequest,
	CreateTermRequest,
	InsurancePolicy,
	UpdateTermRequest,
	Vehicle
} from '#lib/types/index.ts';
import { enteredAmount } from '#lib/utils/insurance.ts';
import { VEHICLES, makePolicy, makeTerm, settle } from './insurance-fixtures.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', async () => ({
	resolve: (await import('./insurance-fixtures.ts')).resolveRoute
}));
vi.mock('#lib/utils/navigation.ts', () => ({ gotoDynamic: vi.fn() }));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showError: vi.fn(), showSuccess: vi.fn() }
}));

const getVehicles = vi.fn<() => Promise<Vehicle[]>>();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => getVehicles() }
}));

const getPolicy = vi.fn<(id: string) => Promise<InsurancePolicy>>();
const createPolicy = vi.fn<(data: CreatePolicyRequest) => Promise<InsurancePolicy>>();
const addTerm = vi.fn<(policyId: string, term: CreateTermRequest) => Promise<InsurancePolicy>>();
const updateTerm =
	vi.fn<(policyId: string, termId: string, term: UpdateTermRequest) => Promise<InsurancePolicy>>();
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getPolicy: (id: string) => getPolicy(id),
		createPolicy: (data: CreatePolicyRequest) => createPolicy(data),
		addTerm: (policyId: string, term: CreateTermRequest) => addTerm(policyId, term),
		updateTerm: (policyId: string, termId: string, term: UpdateTermRequest) =>
			updateTerm(policyId, termId, term)
	}
}));

vi.mock('#lib/components/common/date-picker.svelte', async () => ({
	default: (await import('./DatePickerStub.svelte')).default
}));

const InsurancePolicyForm = (await import('../form/InsurancePolicyForm.svelte')).default;
const InsuranceTermForm = (await import('../form/InsuranceTermForm.svelte')).default;

const TERM = makeTerm({
	id: 't1',
	startDate: '2025-06-01T12:00:00.000Z',
	endDate: '2026-06-01T12:00:00.000Z',
	totalCost: 1200,
	monthlyCost: 100
});
const POLICY = makePolicy({
	id: 'p1',
	terms: [TERM],
	termVehicleCoverage: [{ termId: 't1', vehicleId: 'v1' }]
});

async function type(id: string, value: string) {
	const el = document.getElementById(id);
	if (!el) throw new Error(`missing field #${id}`);
	await fireEvent.input(el, { target: { value } });
}

async function click(name: RegExp) {
	await fireEvent.click(screen.getByRole('button', { name }));
	await settle();
}

async function fillPolicyBasics() {
	await type('company', 'State Farm');
	await type('start-date', '2026-01-01');
	await type('end-date', '2027-01-01');
	await fireEvent.click(screen.getByRole('checkbox', { name: 'Daily' }));
}

async function fillTermBasics() {
	await type('start-date', '2026-07-01');
	await type('end-date', '2027-07-01');
	await fireEvent.click(screen.getByRole('checkbox', { name: 'Daily' }));
}

beforeEach(() => {
	vi.clearAllMocks();
	getVehicles.mockResolvedValue(VEHICLES);
	getPolicy.mockResolvedValue(POLICY);
	createPolicy.mockResolvedValue(POLICY);
	addTerm.mockResolvedValue(POLICY);
	updateTerm.mockResolvedValue(POLICY);
});

afterEach(() => {
	cleanup();
});

describe('enteredAmount', () => {
	test('keeps 0 and reads blank as no value', () => {
		expect(enteredAmount(0)).toBe(0);
		expect(enteredAmount('0')).toBe(0);
		expect(enteredAmount(12.5)).toBe(12.5);
		expect(enteredAmount('')).toBeUndefined();
		expect(enteredAmount(null)).toBeUndefined();
		expect(enteredAmount(undefined)).toBeUndefined();
	});
});

describe('InsurancePolicyForm zero amounts', () => {
	test('a zero deductible is flagged instead of silently dropped', async () => {
		render(InsurancePolicyForm);
		await settle();
		await fillPolicyBasics();
		await type('deductible', '0');
		await click(/Create Policy/);

		expect(screen.getByText('Must be positive')).toBeInTheDocument();
		expect(createPolicy).not.toHaveBeenCalled();
	});

	test('a zero total cost is sent as 0', async () => {
		render(InsurancePolicyForm);
		await settle();
		await fillPolicyBasics();
		await type('total-cost', '0');
		await click(/Create Policy/);

		expect(createPolicy).toHaveBeenCalledTimes(1);
		expect(createPolicy.mock.calls[0]?.[0].terms[0]).toMatchObject({ totalCost: 0 });
	});
});

describe('InsuranceTermForm zero amounts', () => {
	test('a zero deductible on a new term is flagged instead of silently dropped', async () => {
		render(InsuranceTermForm, { props: { policyId: 'p1' } });
		await settle();
		await fillTermBasics();
		await type('deductible', '0');
		await click(/Save Term/);

		expect(screen.getByText('Must be positive')).toBeInTheDocument();
		expect(addTerm).not.toHaveBeenCalled();
	});

	test('a zero total cost on a new term is sent as 0', async () => {
		render(InsuranceTermForm, { props: { policyId: 'p1' } });
		await settle();
		await fillTermBasics();
		await type('total-cost', '0');
		await click(/Save Term/);

		expect(addTerm.mock.calls[0]?.[1]).toMatchObject({ totalCost: 0 });
	});

	test('editing a cost down to 0 sends 0, not null', async () => {
		render(InsuranceTermForm, { props: { policyId: 'p1', termId: 't1' } });
		await settle();
		await type('total-cost', '0');
		await type('monthly-cost', '0');
		await click(/Update Term/);

		expect(updateTerm.mock.calls[0]?.[2]).toMatchObject({ totalCost: 0, monthlyCost: 0 });
	});
});
