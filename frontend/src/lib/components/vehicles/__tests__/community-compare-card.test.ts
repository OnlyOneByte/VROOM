import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { CompareMetric, CompareResult } from '#lib/services/community-api.ts';
import type { UpdateVehicleRequest, Vehicle } from '#lib/types/index.ts';

const { compare, updateVehicle, showError, settingsState } = vi.hoisted(() => ({
	compare: vi.fn<(vehicleId: string) => Promise<CompareResult>>(),
	updateVehicle: vi.fn<(id: string, data: UpdateVehicleRequest) => Promise<Vehicle>>(),
	showError: vi.fn<(message: string) => void>(),
	settingsState: { mode: 'local' as 'local' | 'off', minGroup: undefined as number | undefined }
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/community-api.ts', () => ({
	communityApi: { compare: (vehicleId: string) => compare(vehicleId) }
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		updateVehicle: (id: string, data: UpdateVehicleRequest) => updateVehicle(id, data)
	}
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showError: (message: string) => showError(message) }
}));
const authState = { demo: false };
vi.mock('#lib/stores/auth.svelte.ts', () => ({
	authStore: {
		get user() {
			return { id: 'u1', demo: authState.demo };
		}
	}
}));
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		get settings() {
			return {
				communityStatsMode: settingsState.mode,
				communityStatsMinGroup: settingsState.minGroup
			};
		},
		unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
	}
}));

const CommunityCompareCard = (await import('../CommunityCompareCard.svelte')).default;

const VEHICLE: Vehicle = {
	id: 'veh-1',
	make: 'Honda',
	model: 'Civic EX',
	year: 2019,
	vehicleType: 'gas',
	catalogModelId: null,
	trackFuel: true,
	trackCharging: false,
	unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' },
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
};

function metric(name: CompareMetric['metric'], overrides: Partial<CompareMetric>): CompareMetric {
	return { metric: name, status: 'no_data', unit: null, yours: null, bucket: null, ...overrides };
}

function all(status: CompareMetric['status']): CompareResult {
	return {
		currency: null,
		metrics: (['efficiency', 'running_cost', 'maintenance', 'insurance'] as const).map(name =>
			metric(name, { status })
		)
	};
}

const OK_EFFICIENCY = metric('efficiency', {
	status: 'ok',
	unit: 'distance_per_volume',
	yours: 34,
	bucket: { n: 40, mean: 31, computedAt: '2026-11-23T00:00:00Z' }
});

function data(...metrics: CompareMetric[]): CompareResult {
	return { currency: 'USD', metrics };
}

async function settle() {
	for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount(props: { vehicle?: Vehicle; isOwner?: boolean } = {}) {
	const onVehicleUpdated = vi.fn<(vehicle: Vehicle) => void>();
	render(CommunityCompareCard, {
		props: { vehicle: props.vehicle ?? VEHICLE, isOwner: props.isOwner ?? true, onVehicleUpdated }
	});
	await settle();
	return { onVehicleUpdated };
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	settingsState.mode = 'local';
	authState.demo = false;
});

afterEach(() => {
	cleanup();
});

describe('CommunityCompareCard', () => {
	test('the heading that receives focus shows the standard focus ring', async () => {
		compare.mockResolvedValue(data(OK_EFFICIENCY));
		await mount();
		expect(screen.getByRole('heading', { name: 'Compare with others' })).toHaveClass(
			'focus-visible:ring-[3px]',
			'focus-visible:ring-ring/50'
		);
	});

	test('focus returns to the heading after a successful Retry', async () => {
		compare.mockRejectedValueOnce(new Error('offline'));
		compare.mockResolvedValueOnce(data(OK_EFFICIENCY));
		await mount({ vehicle: { ...VEHICLE, catalogModelId: 'honda-civic' } });
		const retry = screen.getByRole('button', { name: 'Retry' });
		retry.focus();
		await fireEvent.click(retry);
		await settle();
		expect(document.activeElement).toBe(
			screen.getByRole('heading', { name: 'Compare with others' })
		);
	});

	test('shows a three-row skeleton while loading', async () => {
		compare.mockReturnValue(new Promise(() => {}));
		await mount();
		expect(screen.getByTestId('community-compare-loading').children).toHaveLength(3);
	});

	test('is not rendered when the server has the feature off', async () => {
		settingsState.mode = 'off';
		await mount();
		expect(screen.queryByTestId('community-compare')).toBeNull();
		expect(compare).not.toHaveBeenCalled();
	});

	test('is not rendered when the API reports the feature off', async () => {
		compare.mockResolvedValue(all('feature_off'));
		await mount();
		expect(screen.queryByTestId('community-compare')).toBeNull();
	});

	test('a user who has not opted in gets a link to the settings card and no numbers', async () => {
		compare.mockResolvedValue(all('opt_in_required'));
		await mount();
		expect(
			screen.getByText('See how your Civic EX compares with other owners on this server.')
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Turn on community stats' })).toHaveAttribute(
			'href',
			'/settings#community-comparisons'
		);
		expect(screen.queryByText(/owners ·|about \d+ owners/)).toBeNull();
	});

	test('a demo visitor sees what the card does but gets no opt-in link they cannot use', async () => {
		authState.demo = true;
		compare.mockResolvedValue(all('opt_in_required'));
		await mount();
		expect(
			screen.getByText('See how your Civic EX compares with other owners on this server.')
		).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Turn on community stats' })).toBeNull();
		expect(screen.getByText('Community comparisons aren’t part of the demo.')).toBeInTheDocument();
	});

	test('a signed-in user who has not opted in gets the link and no demo line', async () => {
		compare.mockResolvedValue(all('opt_in_required'));
		await mount();
		expect(screen.getByRole('link', { name: 'Turn on community stats' })).toBeInTheDocument();
		expect(screen.queryByText('Community comparisons aren’t part of the demo.')).toBeNull();
	});

	test('a user whose opt-in is not in a refresh yet is told to wait, with no numbers', async () => {
		compare.mockResolvedValue(all('awaiting_refresh'));
		await mount();
		expect(screen.getByTestId('community-compare-awaiting')).toHaveTextContent(
			"You're in. Comparisons appear after the next daily refresh includes your vehicles."
		);
		expect(screen.queryByRole('link', { name: 'Turn on community stats' })).toBeNull();
		expect(screen.queryByTestId('community-compare-efficiency')).toBeNull();
	});

	test('shows the comparison row with the average, rounded n and a text equivalent', async () => {
		compare.mockResolvedValue(data(OK_EFFICIENCY));
		await mount({ vehicle: { ...VEHICLE, catalogModelId: 'honda-civic' } });
		const row = screen.getByTestId('community-compare-efficiency');
		expect(row).toHaveTextContent('You 34.0 mi/gal · Others 31.0 mi/gal (average)');
		expect(row).not.toHaveTextContent('typical');
		expect(row).toHaveTextContent('about 40 owners');
		expect(screen.getByRole('img')).toHaveAttribute(
			'aria-label',
			"Your 34.0 mi/gal is above the others' average of 31.0 mi/gal"
		);
		expect(
			screen.getByText('Updated daily. Anonymous averages from opted-in owners, including you.')
		).toBeInTheDocument();
	});

	test('values that round to the same figure read as the same, not above or below', async () => {
		compare.mockResolvedValue(
			data(
				metric('efficiency', {
					status: 'ok',
					unit: 'distance_per_volume',
					yours: 31.04,
					bucket: { n: 40, mean: 31, computedAt: '' }
				})
			)
		);
		await mount({ vehicle: { ...VEHICLE, catalogModelId: 'honda-civic' } });
		expect(screen.getByRole('img')).toHaveAttribute(
			'aria-label',
			"Your 31.0 mi/gal is the same as the others' average of 31.0 mi/gal"
		);
	});

	test('formats costs in the currency with the distance unit, and yearly costs per year', async () => {
		compare.mockResolvedValue(
			data(
				metric('running_cost', {
					status: 'ok',
					unit: 'cents_per_distance',
					yours: 12.4,
					bucket: { n: 15, mean: 11, computedAt: '' }
				}),
				metric('maintenance', {
					status: 'ok',
					unit: 'cents_per_year',
					yours: 45_000,
					bucket: { n: 10, mean: 60_000, computedAt: '' }
				})
			)
		);
		await mount();
		expect(screen.getByTestId('community-compare-running_cost')).toHaveTextContent(
			'You $0.12/mi · Others $0.11/mi'
		);
		expect(screen.getByTestId('community-compare-maintenance')).toHaveTextContent(
			'You $450/yr · Others $600/yr'
		);
		expect(screen.getAllByRole('img')[1]).toHaveAttribute(
			'aria-label',
			"Your $450/yr is below the others' average of $600/yr"
		);
	});

	test('a no-decimal currency is shown in whole units, not divided by 100', async () => {
		compare.mockResolvedValue({
			currency: 'JPY',
			metrics: [
				metric('maintenance', {
					status: 'ok',
					unit: 'cents_per_year',
					yours: 45_000,
					bucket: { n: 10, mean: 60_000, computedAt: '' }
				})
			]
		});
		await mount();
		expect(screen.getByTestId('community-compare-maintenance')).toHaveTextContent(
			'You ¥45,000/yr · Others ¥60,000/yr'
		);
	});

	test('too few owners never says how many there are', async () => {
		compare.mockResolvedValue(data(metric('efficiency', { status: 'too_few', yours: 34 })));
		await mount({ vehicle: { ...VEHICLE, catalogModelId: 'honda-civic' } });
		expect(screen.getByTestId('community-compare-efficiency')).toHaveTextContent(
			'Not enough owners yet.'
		);
		expect(
			screen.getByText(
				'Comparisons appear once about 30 people on this server with a similar vehicle have opted in.'
			)
		).toBeInTheDocument();
		expect(screen.queryByText(/\d+ owners/)).toBeNull();
	});

	test("the group size in the hint is the server's publication threshold", async () => {
		settingsState.minGroup = 45;
		try {
			compare.mockResolvedValue(data(metric('efficiency', { status: 'too_few', yours: 34 })));
			await mount({ vehicle: { ...VEHICLE, catalogModelId: 'honda-civic' } });
			expect(screen.getByText(/Comparisons appear once about 45 people/)).toBeInTheDocument();
		} finally {
			settingsState.minGroup = undefined;
		}
	});

	test('an average too noisy to be useful explains why, with no numbers', async () => {
		compare.mockResolvedValue(data(metric('efficiency', { status: 'not_enough_data', yours: 34 })));
		await mount({ vehicle: { ...VEHICLE, catalogModelId: 'honda-civic' } });
		const row = screen.getByTestId('community-compare-efficiency');
		expect(row).toHaveTextContent(
			'Not enough owners yet for a reliable average. It shows once more people with a similar vehicle have opted in.'
		);
		expect(row).not.toHaveTextContent(/\d/);
	});

	test('no data of your own explains what to log', async () => {
		compare.mockResolvedValue(data(metric('efficiency', { status: 'no_data' })));
		await mount({ vehicle: { ...VEHICLE, catalogModelId: 'honda-civic' } });
		expect(
			screen.getByText('Log at least 3 fill-ups with odometer readings to compare.')
		).toBeInTheDocument();
	});

	test('a share recipient sees that the owner-only metrics are not available', async () => {
		compare.mockResolvedValue(data(metric('running_cost', { status: 'no_data' })));
		await mount({ isOwner: false });
		expect(screen.getByTestId('community-compare-running_cost')).toHaveTextContent(
			'Only the owner can compare this.'
		);
	});

	test('needs model: Yes sets the catalogue model and reloads', async () => {
		compare.mockResolvedValueOnce(data(metric('efficiency', { status: 'needs_model' })));
		compare.mockResolvedValueOnce(data(OK_EFFICIENCY));
		updateVehicle.mockResolvedValue({ ...VEHICLE, catalogModelId: 'honda-civic' });
		const { onVehicleUpdated } = await mount();

		expect(await screen.findByText('Is this a Honda Civic?')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
		await settle();

		expect(updateVehicle).toHaveBeenCalledWith('veh-1', { catalogModelId: 'honda-civic' });
		expect(onVehicleUpdated).toHaveBeenCalledWith(
			expect.objectContaining({ catalogModelId: 'honda-civic' })
		);
		expect(compare).toHaveBeenCalledTimes(2);
		expect(screen.getByTestId('community-compare-efficiency')).toHaveTextContent('You 34.0');
		expect(document.activeElement).toBe(
			screen.getByRole('heading', { name: 'Compare with others' })
		);
	});

	test('needs model: No hides the prompt for this vehicle, also after a reload', async () => {
		compare.mockResolvedValue(data(metric('efficiency', { status: 'needs_model' })));
		await mount();
		await fireEvent.click(await screen.findByRole('button', { name: "No, it's something else" }));
		await settle();
		expect(screen.queryByText('Is this a Honda Civic?')).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole('heading', { name: 'Compare with others' })
		);
		expect(updateVehicle).not.toHaveBeenCalled();

		cleanup();
		await mount();
		expect(screen.queryByText('Is this a Honda Civic?')).toBeNull();
		expect(screen.getByTestId('community-compare-efficiency')).toHaveTextContent(
			'Pick the model from the list when you edit this vehicle'
		);
	});

	test('the prompt uses the catalogue spelling of the make', async () => {
		compare.mockResolvedValue(data(metric('efficiency', { status: 'needs_model' })));
		await mount({ vehicle: { ...VEHICLE, make: 'honda', model: 'civic ex' } });
		expect(await screen.findByText('Is this a Honda Civic?')).toBeInTheDocument();
	});

	test('a share recipient who has not opted in is told about this vehicle, not theirs', async () => {
		compare.mockResolvedValue(all('opt_in_required'));
		await mount({ isOwner: false });
		expect(
			screen.getByText('See how this Civic EX compares with other owners on this server.')
		).toBeInTheDocument();
	});

	test('an electric vehicle labels its first row Efficiency and the distance hint follows units', async () => {
		compare.mockResolvedValue(
			data(
				metric('efficiency', { status: 'no_data' }),
				metric('running_cost', { status: 'no_data' })
			)
		);
		await mount({
			vehicle: {
				...VEHICLE,
				vehicleType: 'electric',
				catalogModelId: 'tesla-model-3',
				unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
			}
		});
		expect(screen.getByTestId('community-compare-efficiency')).toHaveTextContent('Efficiency');
		expect(screen.getByTestId('community-compare-efficiency')).not.toHaveTextContent('Fuel');
		expect(screen.getByTestId('community-compare-running_cost')).toHaveTextContent('500 km');
		expect(screen.getByTestId('community-compare-running_cost')).not.toHaveTextContent('mi');
	});

	test('needs model is never offered to a share recipient', async () => {
		compare.mockResolvedValue(data(metric('efficiency', { status: 'needs_model' })));
		await mount({ isOwner: false });
		expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull();
		expect(screen.getByTestId('community-compare-efficiency')).toHaveTextContent(
			'Only the owner can compare this.'
		);
	});

	test('a failed load shows an inline error, and Retry loads again', async () => {
		compare.mockRejectedValueOnce(new Error('offline'));
		compare.mockResolvedValueOnce(data(OK_EFFICIENCY));
		await mount({ vehicle: { ...VEHICLE, catalogModelId: 'honda-civic' } });
		expect(screen.getByTestId('community-compare-error')).toHaveTextContent(
			"Couldn't load community comparisons"
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(screen.getByTestId('community-compare-efficiency')).toBeInTheDocument();
	});

	test('a failed model save shows an error and keeps the prompt', async () => {
		compare.mockResolvedValue(data(metric('efficiency', { status: 'needs_model' })));
		updateVehicle.mockRejectedValue(new Error('nope'));
		await mount();
		await fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));
		await settle();
		expect(showError).toHaveBeenCalledWith(expect.stringContaining("Couldn't save the model."));
		expect(await screen.findByText('Is this a Honda Civic?')).toBeInTheDocument();
	});
});
