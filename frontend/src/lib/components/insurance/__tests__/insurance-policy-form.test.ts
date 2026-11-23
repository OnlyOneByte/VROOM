import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import type {
	CreatePolicyRequest,
	InsurancePolicy,
	UpdatePolicyRequest,
	Vehicle
} from '#lib/types/index.ts';
import { dateOnlyToISO } from '#lib/utils/formatters.ts';
import { VEHICLES, makePolicy, settle } from './insurance-fixtures.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const goto = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto: (url: string) => goto(url) }));
vi.mock('$app/paths', async () => ({
	resolve: (await import('./insurance-fixtures.ts')).resolveRoute
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
const createPolicy = vi.fn<(data: CreatePolicyRequest) => Promise<InsurancePolicy>>();
const updatePolicy = vi.fn<(id: string, data: UpdatePolicyRequest) => Promise<InsurancePolicy>>();
const deletePolicy = vi.fn<(id: string) => Promise<void>>();
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getPolicy: (id: string) => getPolicy(id),
		createPolicy: (data: CreatePolicyRequest) => createPolicy(data),
		updatePolicy: (id: string, data: UpdatePolicyRequest) => updatePolicy(id, data),
		deletePolicy: (id: string) => deletePolicy(id)
	}
}));

vi.mock('#lib/components/common/date-picker.svelte', async () => ({
	default: (await import('./DatePickerStub.svelte')).default
}));

const InsurancePolicyForm = (await import('../form/InsurancePolicyForm.svelte')).default;

async function mount(props: Record<string, unknown> = {}) {
	const result = render(InsurancePolicyForm, { props });
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

async function clickCreate() {
	await fireEvent.click(screen.getByRole('button', { name: /Create Policy/ }));
	await settle();
}

async function fillRequiredCreateFields() {
	await type('company', '  State Farm  ');
	await type('start-date', '2026-01-01');
	await type('end-date', '2027-01-01');
	await fireEvent.click(screen.getByRole('checkbox', { name: 'Daily' }));
}

beforeEach(() => {
	vi.clearAllMocks();
	getVehicles.mockResolvedValue(VEHICLES);
	createPolicy.mockResolvedValue(makePolicy());
	updatePolicy.mockResolvedValue(makePolicy());
	deletePolicy.mockResolvedValue();
});

afterEach(() => {
	cleanup();
});

describe('InsurancePolicyForm create mode', () => {
	test('renders the create heading and one checkbox per vehicle', async () => {
		await mount();
		expect(screen.getByRole('heading', { name: 'New Insurance Policy' })).toBeInTheDocument();
		expect(screen.getByText('Add a new insurance policy with an initial term')).toBeInTheDocument();
		expect(screen.getByRole('checkbox', { name: 'Daily' })).toBeInTheDocument();
		expect(screen.getByRole('checkbox', { name: '2019 Honda Civic' })).toBeInTheDocument();
		expect(getPolicy).not.toHaveBeenCalled();
	});

	test('headings run h1, h2, h3 without skipping a level', async () => {
		await mount();

		const levels = screen.getAllByRole('heading').map(h => Number(h.tagName.slice(1)));
		expect(levels[0]).toBe(1);
		for (let i = 1; i < levels.length; i++) {
			expect(levels[i], `heading ${i}`).toBeLessThanOrEqual((levels[i - 1] ?? 1) + 1);
		}
		expect(screen.getByRole('heading', { level: 2, name: 'Initial Term' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { level: 3, name: 'Policy Details' })).toBeInTheDocument();
	});

	test('the save bar is fixed below lg and a normal row from lg or on a short viewport, with a plain primary Save button', async () => {
		await mount();
		const save = screen.getByRole('button', { name: 'Create Policy' });

		expect(save.closest('.fixed')).toHaveClass('lg:static', 'short:static');
		expect(save).toHaveClass('shadow-sm', 'transition-colors');
		expect(save.className).not.toMatch(/shadow-2xl|bg-foreground|hover:scale/);
	});

	test('with no vehicles, shows the Add Vehicle empty state instead of the form', async () => {
		getVehicles.mockResolvedValue([]);
		await mount();
		expect(screen.getByRole('heading', { name: 'Add a vehicle first' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Add Vehicle' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Create Policy/ })).toBeNull();
		expect(screen.queryByLabelText(/Company/)).toBeNull();
	});

	test('preselects the vehicle passed in props', async () => {
		await mount({ preselectedVehicleId: 'v2' });
		expect(screen.getByRole('checkbox', { name: '2019 Honda Civic' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		expect(screen.getByRole('checkbox', { name: 'Daily' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	test('submitting an empty form flags every required field and sends nothing', async () => {
		await mount();
		await clickCreate();
		expect(screen.getByText('Company name is required')).toBeInTheDocument();
		expect(screen.getByText('At least one vehicle is required')).toBeInTheDocument();
		expect(screen.getByText('Start date is required')).toBeInTheDocument();
		expect(screen.getByText('End date is required')).toBeInTheDocument();
		expect(field('company')).toHaveAttribute('aria-invalid', 'true');
		expect(field('company')).toHaveAttribute('aria-describedby', 'company-error');
		expect(createPolicy).not.toHaveBeenCalled();
	});

	test('a blocked submit moves focus to the first invalid field', async () => {
		await mount();
		await clickCreate();
		await vi.waitFor(() => expect(document.activeElement).toBe(field('company')));
	});

	test('with only the vehicles missing, focus lands on the first vehicle checkbox', async () => {
		await mount({ preselectedVehicleId: undefined });
		await type('company', 'Acme');
		await type('start-date', '2026-01-01');
		await type('end-date', '2026-12-31');
		await clickCreate();
		const first = screen
			.getAllByRole('checkbox')
			.find(c => c.getAttribute('aria-invalid') === 'true');
		expect(first).toBeDefined();
		await vi.waitFor(() => expect(document.activeElement).toBe(first));
		expect(first).toHaveAttribute('aria-describedby', 'vehicles-error');
	});

	test.each([
		['an end date before the start date', '2026-06-01', '2026-01-01'],
		['an end date equal to the start date', '2026-06-01', '2026-06-01']
	])('rejects %s', async (_label, start, end) => {
		await mount();
		await type('company', 'Acme');
		await type('start-date', start);
		await type('end-date', end);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Daily' }));
		await clickCreate();
		expect(screen.getByText('End date must be after start date')).toBeInTheDocument();
		expect(createPolicy).not.toHaveBeenCalled();
	});

	test('rejects non-positive deductible and coverage limit and a negative total cost', async () => {
		await mount();
		await fillRequiredCreateFields();
		await type('deductible', '-0.01');
		await type('coverage-limit', '-5');
		await type('total-cost', '-1');
		await clickCreate();
		expect(screen.getAllByText('Must be positive')).toHaveLength(2);
		expect(screen.getByText('Must be non-negative')).toBeInTheDocument();
		expect(field('deductible')).toHaveAttribute('aria-describedby', 'deductible-error');
		expect(field('coverage-limit')).toHaveAttribute('aria-describedby', 'coverage-limit-error');
		expect(field('total-cost')).toHaveAttribute('aria-describedby', 'total-cost-error');
		expect(createPolicy).not.toHaveBeenCalled();
	});

	test('sends only the required term fields when the optional ones are blank', async () => {
		await mount();
		await fillRequiredCreateFields();
		await clickCreate();
		expect(createPolicy).toHaveBeenCalledWith({
			company: 'State Farm',
			terms: [
				{
					startDate: dateOnlyToISO('2026-01-01'),
					endDate: dateOnlyToISO('2027-01-01'),
					vehicleCoverage: { vehicleIds: ['v1'] }
				}
			],
			notes: undefined,
			isActive: true
		});
		expect(showSuccess).toHaveBeenCalledWith('Policy created successfully');
		expect(goto).toHaveBeenCalledWith('/insurance');
	});

	test('sends every entered term field with numbers and trimmed text as typed', async () => {
		await mount();
		await fillRequiredCreateFields();
		await fireEvent.click(screen.getByRole('checkbox', { name: '2019 Honda Civic' }));
		await type('notes', '  multi-car  ');
		await type('policy-number', ' SF-1 ');
		await type('coverage-desc', ' Full ');
		await type('deductible', '500');
		await type('coverage-limit', '100000');
		await type('agent-name', ' Jane ');
		await type('agent-phone', ' 555-0100 ');
		await type('agent-email', ' jane@example.com ');
		await type('total-cost', '1200.50');
		await type('monthly-cost', '100.04');
		await type('payment-amount', '600.25');
		await fireEvent.click(screen.getByRole('switch'));
		await clickCreate();

		const request = createPolicy.mock.calls[0]?.[0];
		expect(request?.notes).toBe('multi-car');
		expect(request?.isActive).toBe(false);
		expect(request?.terms[0]).toEqual({
			startDate: dateOnlyToISO('2026-01-01'),
			endDate: dateOnlyToISO('2027-01-01'),
			policyNumber: 'SF-1',
			coverageDescription: 'Full',
			deductibleAmount: 500,
			coverageLimit: 100000,
			agentName: 'Jane',
			agentPhone: '555-0100',
			agentEmail: 'jane@example.com',
			totalCost: 1200.5,
			monthlyCost: 100.04,
			paymentAmount: 600.25,
			vehicleCoverage: { vehicleIds: ['v1', 'v2'] }
		});
	});

	test('unchecking a selected vehicle removes it from coverage', async () => {
		await mount({ preselectedVehicleId: 'v1' });
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Daily' }));
		await type('company', 'Acme');
		await type('start-date', '2026-01-01');
		await type('end-date', '2027-01-01');
		await clickCreate();
		expect(screen.getByText('At least one vehicle is required')).toBeInTheDocument();
		expect(createPolicy).not.toHaveBeenCalled();
	});

	test('a create failure reports the API message and keeps the user on the form', async () => {
		createPolicy.mockRejectedValue(new ApiError('Server exploded', 500));
		await mount();
		await fillRequiredCreateFields();
		await clickCreate();
		expect(showError).toHaveBeenCalledWith(`Couldn't create the policy. ${SERVER_FAILURE_MESSAGE}`);
		expect(goto).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: /Create Policy/ })).not.toBeDisabled();
	});

	test('a non-Error rejection is reported as an unknown error', async () => {
		createPolicy.mockRejectedValue('nope');
		await mount();
		await fillRequiredCreateFields();
		await clickCreate();
		expect(showError).toHaveBeenCalledWith(
			`Couldn't create the policy. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
	});

	test('the submit button shows a creating state while the request is pending', async () => {
		createPolicy.mockReturnValue(new Promise(() => {}));
		await mount();
		await fillRequiredCreateFields();
		await clickCreate();
		expect(screen.getByRole('button', { name: /Creating/ })).toBeDisabled();
		expect(screen.getByRole('button', { name: /Cancel/ })).toBeDisabled();
	});

	test('a create in flight counts as unsaved changes until the form closes', async () => {
		createPolicy.mockReturnValue(new Promise(() => {}));
		const { unmount } = await mount();
		await fillRequiredCreateFields();
		expect(hasPendingSave()).toBe(false);

		await clickCreate();

		expect(hasPendingSave()).toBe(true);
		unmount();
		expect(hasPendingSave()).toBe(false);
	});

	test('cancel and back both return to the returnTo path', async () => {
		await mount({ returnTo: '/vehicles/v1' });
		await fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
		expect(gotoDynamic).toHaveBeenNthCalledWith(1, '/vehicles/v1');
		expect(gotoDynamic).toHaveBeenNthCalledWith(2, '/vehicles/v1');
		expect(createPolicy).not.toHaveBeenCalled();
	});

	test('a vehicle load failure stays on the page with a Retry that reloads', async () => {
		getVehicles.mockRejectedValueOnce(new ApiError('SQLITE_BUSY', 500));
		await mount({ returnTo: '/vehicles/v1' });
		expect(screen.getByText("Couldn't load your vehicles")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(gotoDynamic).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(getVehicles).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't load your vehicles")).toBeNull();
		expect(screen.getByLabelText(/Insurance Company/)).toBeInTheDocument();
	});

	test('shows a spinner until vehicles load', async () => {
		getVehicles.mockReturnValue(new Promise(() => {}));
		const { container } = await mount();
		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(screen.queryByRole('heading')).toBeNull();
	});
});

describe('InsurancePolicyForm edit mode', () => {
	const existing = makePolicy({
		id: 'p9',
		company: 'Acme Mutual',
		notes: 'Old note',
		isActive: false,
		vehicleIds: ['v1']
	});

	beforeEach(() => {
		getPolicy.mockResolvedValue(existing);
	});

	test('prefills the policy fields and hides the initial-term section', async () => {
		await mount({ policyId: 'p9' });
		expect(getPolicy).toHaveBeenCalledWith('p9');
		expect(screen.getByRole('heading', { name: 'Edit Policy' })).toBeInTheDocument();
		expect(field('company')).toHaveValue('Acme Mutual');
		expect(field('notes')).toHaveValue('Old note');
		expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
		expect(screen.queryByText('Initial Term')).toBeNull();
		expect(document.getElementById('start-date')).toBeNull();
	});

	test('still shows the form when the account has no vehicles left', async () => {
		getVehicles.mockResolvedValue([]);
		await mount({ policyId: 'p9' });
		expect(field('company')).toHaveValue('Acme Mutual');
		expect(screen.queryByRole('heading', { name: 'Add a vehicle first' })).toBeNull();
	});

	test('sends only company, notes and active flag on update', async () => {
		await mount({ policyId: 'p9', returnTo: '/insurance/p9' });
		await type('company', '  Acme Renamed ');
		await type('notes', 'New note');
		await fireEvent.click(screen.getByRole('switch'));
		await fireEvent.click(screen.getByRole('button', { name: /Update Policy/ }));
		await settle();
		expect(updatePolicy).toHaveBeenCalledWith('p9', {
			company: 'Acme Renamed',
			notes: 'New note',
			isActive: true
		});
		expect(showSuccess).toHaveBeenCalledWith('Policy updated successfully');
		expect(gotoDynamic).toHaveBeenCalledWith('/insurance/p9');
	});

	test('clearing the notes sends null so the server drops them', async () => {
		await mount({ policyId: 'p9' });
		await type('notes', '   ');
		await fireEvent.click(screen.getByRole('button', { name: /Update Policy/ }));
		await settle();
		expect(updatePolicy).toHaveBeenCalledWith('p9', {
			company: 'Acme Mutual',
			notes: null,
			isActive: false
		});
	});

	test('a blank company blocks the update without date validation', async () => {
		await mount({ policyId: 'p9' });
		await type('company', '');
		await fireEvent.click(screen.getByRole('button', { name: /Update Policy/ }));
		await settle();
		expect(screen.getByText('Company name is required')).toBeInTheDocument();
		expect(screen.queryByText('Start date is required')).toBeNull();
		expect(updatePolicy).not.toHaveBeenCalled();
	});

	test('an update failure reports with the update verb', async () => {
		updatePolicy.mockRejectedValue(new ApiError('Policy number already in use', 409));
		await mount({ policyId: 'p9' });
		await fireEvent.click(screen.getByRole('button', { name: /Update Policy/ }));
		await settle();
		expect(showError).toHaveBeenCalledWith(
			"Couldn't update the policy. Policy number already in use."
		);
		expect(gotoDynamic).not.toHaveBeenCalled();
	});

	test('a policy that no longer exists is reported and the user is sent back', async () => {
		getPolicy.mockRejectedValue(new ApiError('Policy not found', 404));
		await mount({ policyId: 'p9', returnTo: '/insurance' });
		expect(showError).toHaveBeenCalledWith('That policy no longer exists.');
		expect(gotoDynamic).toHaveBeenCalledWith('/insurance');
	});

	test('a policy server failure stays on the page with a Retry that reloads the policy', async () => {
		getPolicy.mockRejectedValueOnce(new ApiError('Internal server error', 500));
		await mount({ policyId: 'p9', returnTo: '/insurance' });
		expect(screen.getByText("Couldn't load this policy")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(gotoDynamic).not.toHaveBeenCalled();
		expect(showError).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(getPolicy).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't load this policy")).toBeNull();
		expect(screen.getByRole('heading', { name: 'Edit Policy' })).toBeInTheDocument();
	});

	test('delete asks for confirmation and then deletes the policy', async () => {
		await mount({ policyId: 'p9' });
		await fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
		await settle();
		expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
		expect(screen.getByText('1 vehicle covered')).toBeInTheDocument();
		expect(deletePolicy).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: /Delete Policy/ }));
		await settle();
		expect(deletePolicy).toHaveBeenCalledWith('p9');
		expect(showSuccess).toHaveBeenCalledWith('Policy deleted successfully');
		expect(goto).toHaveBeenCalledWith('/insurance');
	});

	test('the delete confirmation pluralises the covered-vehicle count', async () => {
		getPolicy.mockResolvedValue({ ...existing, vehicleIds: ['v1', 'v2'] });
		await mount({ policyId: 'p9' });
		await fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
		expect(await screen.findByText('2 vehicles covered')).toBeInTheDocument();
	});

	test('a delete failure reports the API message and closes the dialog', async () => {
		deletePolicy.mockRejectedValue(new ApiError('This policy still has claims', 409));
		await mount({ policyId: 'p9' });
		await fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
		await screen.findByRole('alertdialog');
		await fireEvent.click(screen.getByRole('button', { name: /Delete Policy/ }));
		await settle();
		expect(showError).toHaveBeenCalledWith(
			"Couldn't delete the policy. This policy still has claims."
		);
		expect(goto).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});

	test('a non-Error delete failure falls back to the generic message', async () => {
		deletePolicy.mockRejectedValue('nope');
		await mount({ policyId: 'p9' });
		await fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
		await screen.findByRole('alertdialog');
		await fireEvent.click(screen.getByRole('button', { name: /Delete Policy/ }));
		await settle();
		expect(showError).toHaveBeenCalledWith(
			`Couldn't delete the policy. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
	});
});
