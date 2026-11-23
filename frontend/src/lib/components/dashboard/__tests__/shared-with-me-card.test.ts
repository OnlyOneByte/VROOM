import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ReceivedShare } from '#lib/types/index.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

const { listReceived, accept, decline, toastSuccess, toastError } = vi.hoisted(() => ({
	listReceived: vi.fn<() => Promise<ReceivedShare[]>>(),
	accept: vi.fn<(id: string) => Promise<void>>(),
	decline: vi.fn<(id: string) => Promise<void>>(),
	toastSuccess: vi.fn<(message: string) => void>(),
	toastError: vi.fn<(message: string) => void>()
}));

vi.mock('#lib/services/share-api.ts', () => ({
	shareApi: {
		listReceived: () => listReceived(),
		accept: (id: string) => accept(id),
		decline: (id: string) => decline(id)
	}
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showError: (message: string) => toastError(message) }
}));
vi.mock('svelte-sonner', () => ({
	toast: {
		success: (message: string) => toastSuccess(message),
		error: (message: string) => toastError(message)
	}
}));

const SharedWithMeCard = (await import('../SharedWithMeCard.svelte')).default;

function share(overrides: Partial<ReceivedShare> = {}): ReceivedShare {
	return {
		id: 's1',
		vehicleId: 'v1',
		ownerId: 'owner',
		sharedWithId: 'me@example.com',
		level: 'viewer',
		status: 'pending',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		vehicleName: 'Family Van',
		sharedBy: 'Alex',
		...overrides
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount(onAccepted?: () => void) {
	const view = render(SharedWithMeCard, { props: { onAccepted } });
	await settle();
	return view;
}

beforeEach(() => {
	vi.clearAllMocks();
	listReceived.mockResolvedValue([share()]);
	accept.mockResolvedValue();
	decline.mockResolvedValue();
});

afterEach(() => {
	cleanup();
});

describe('SharedWithMeCard listing', () => {
	test('renders nothing while loading', async () => {
		listReceived.mockReturnValue(new Promise(() => {}));
		const { container } = await mount();
		expect(container.textContent?.trim()).toBe('');
	});

	test('renders nothing when there are no pending invitations', async () => {
		listReceived.mockResolvedValue([
			share({ id: 'a', status: 'accepted' }),
			share({ id: 'd', status: 'declined' })
		]);
		const { container } = await mount();
		expect(container.textContent?.trim()).toBe('');
	});

	test('lists only pending invitations with level and sharer', async () => {
		listReceived.mockResolvedValue([
			share({ id: 'p1', vehicleName: 'Family Van', level: 'editor', sharedBy: 'Alex' }),
			share({ id: 'a1', vehicleName: 'Old Truck', status: 'accepted' })
		]);
		await mount();

		expect(screen.getByText('Shared with you')).toBeInTheDocument();
		expect(screen.getByText('Family Van')).toBeInTheDocument();
		expect(screen.getByText('Editor · Shared by Alex')).toBeInTheDocument();
		expect(screen.queryByText('Old Truck')).toBeNull();
	});

	test('a load failure shows the error and Retry reloads', async () => {
		listReceived.mockRejectedValueOnce(new ApiError('Server unavailable', 503));
		await mount();

		expect(screen.getByText("Couldn't load your invitations")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText('Server unavailable')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();

		expect(listReceived).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("Couldn't load your invitations")).toBeNull();
		expect(screen.getByText('Family Van')).toBeInTheDocument();
	});

	test('a non-Error rejection shows a generic load message', async () => {
		listReceived.mockRejectedValueOnce('nope');
		await mount();
		expect(screen.getByText(UNEXPECTED_FAILURE_MESSAGE)).toBeInTheDocument();
	});
});

describe('SharedWithMeCard accepting and declining', () => {
	test('accepting removes the invitation, toasts and notifies the parent', async () => {
		const onAccepted = vi.fn();
		await mount(onAccepted);

		await fireEvent.click(screen.getByRole('button', { name: 'Accept access to Family Van' }));
		await settle();

		expect(accept).toHaveBeenCalledWith('s1');
		expect(toastSuccess).toHaveBeenCalledWith('Accepted access to Family Van');
		expect(onAccepted).toHaveBeenCalledTimes(1);
		expect(screen.queryByText('Family Van')).toBeNull();
	});

	test('accepting works without an onAccepted callback', async () => {
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Accept access to Family Van' }));
		await settle();
		expect(toastSuccess).toHaveBeenCalledWith('Accepted access to Family Van');
	});

	test('both buttons are disabled while the action is in flight', async () => {
		accept.mockReturnValue(new Promise(() => {}));
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Accept access to Family Van' }));
		await settle();

		expect(screen.getByRole('button', { name: 'Accept access to Family Van' })).toBeDisabled();
		expect(
			screen.getByRole('button', { name: 'Decline the invitation to Family Van' })
		).toBeDisabled();
	});

	test('an API error on accept shows its message and keeps the invitation', async () => {
		const onAccepted = vi.fn();
		accept.mockRejectedValue(new ApiError('Invitation expired', 410));
		await mount(onAccepted);
		await fireEvent.click(screen.getByRole('button', { name: 'Accept access to Family Van' }));
		await settle();

		expect(toastError).toHaveBeenCalledWith("Couldn't accept the invitation. Invitation expired.");
		expect(onAccepted).not.toHaveBeenCalled();
		expect(screen.getByText('Family Van')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Accept access to Family Van' })).toBeEnabled();
	});

	test('an unexpected error on accept shows a generic retry message', async () => {
		accept.mockRejectedValue(new TypeError('fetch failed'));
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Accept access to Family Van' }));
		await settle();

		expect(toastError).toHaveBeenCalledWith(
			`Couldn't accept the invitation. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
	});

	test('declining removes the invitation without notifying the parent', async () => {
		const onAccepted = vi.fn();
		listReceived.mockResolvedValue([share(), share({ id: 's2', vehicleName: 'Commuter' })]);
		await mount(onAccepted);

		await fireEvent.click(
			screen.getByRole('button', { name: 'Decline the invitation to Family Van' })
		);
		await settle();

		expect(decline).toHaveBeenCalledWith('s1');
		expect(toastSuccess).toHaveBeenCalledWith('Declined the invitation to Family Van');
		expect(onAccepted).not.toHaveBeenCalled();
		expect(screen.queryByText('Family Van')).toBeNull();
		expect(screen.getByText('Commuter')).toBeInTheDocument();
	});

	test('an API error on decline shows its message', async () => {
		decline.mockRejectedValue(new ApiError('Not found', 404));
		await mount();
		await fireEvent.click(
			screen.getByRole('button', { name: 'Decline the invitation to Family Van' })
		);
		await settle();

		expect(toastError).toHaveBeenCalledWith("Couldn't decline the invitation. Not found.");
		expect(screen.getByText('Family Van')).toBeInTheDocument();
	});

	test('an unexpected error on decline shows a generic retry message', async () => {
		decline.mockRejectedValue(new TypeError('boom'));
		await mount();
		await fireEvent.click(
			screen.getByRole('button', { name: 'Decline the invitation to Family Van' })
		);
		await settle();

		expect(toastError).toHaveBeenCalledWith(
			`Couldn't decline the invitation. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
	});

	test('with invitations the dashboard already loaded it shows them without asking again', async () => {
		render(SharedWithMeCard, {
			props: { received: [share({ id: 'p1', vehicleName: 'Family Van' })] }
		});
		expect(await screen.findByText('Family Van')).toBeInTheDocument();
		expect(listReceived).not.toHaveBeenCalled();
	});

	test('when the dashboard could not load them it offers Retry, which asks again', async () => {
		listReceived.mockResolvedValue([share()]);
		render(SharedWithMeCard, { props: { received: null } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(listReceived).toHaveBeenCalledTimes(1));
	});
});
