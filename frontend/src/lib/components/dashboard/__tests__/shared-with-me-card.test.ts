import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import type { ReceivedShare } from '#lib/types/index.ts';
import { ApiError, UNEXPECTED_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

const { accept, decline, toastSuccess, toastError } = vi.hoisted(() => ({
	accept: vi.fn<(id: string) => Promise<void>>(),
	decline: vi.fn<(id: string) => Promise<void>>(),
	toastSuccess: vi.fn<(message: string) => void>(),
	toastError: vi.fn<(message: string) => void>()
}));

vi.mock('#lib/services/share-api.ts', () => ({
	shareApi: {
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

function mount(
	props: { invitations?: ReceivedShare[]; loadError?: string | null; title?: string | null } = {}
) {
	const handlers = { onRetry: vi.fn(), onAccepted: vi.fn(), onDeclined: vi.fn() };
	const view = render(SharedWithMeCard, {
		props: {
			invitations: props.invitations ?? [share()],
			loadError: props.loadError ?? null,
			...(props.title !== undefined ? { title: props.title } : {}),
			...handlers
		}
	});
	return { ...view, ...handlers };
}

beforeEach(() => {
	vi.clearAllMocks();
	accept.mockResolvedValue();
	decline.mockResolvedValue();
});

afterEach(() => {
	cleanup();
});

describe('SharedWithMeCard listing', () => {
	test('renders nothing when there are no pending invitations', () => {
		const { container } = mount({ invitations: [] });
		expect(container.textContent?.trim()).toBe('');
	});

	test('lists each invitation with its level and sharer', () => {
		mount({ invitations: [share({ id: 'p1', level: 'editor', sharedBy: 'Alex' })] });

		expect(screen.getByText('Shared with you')).toBeInTheDocument();
		expect(screen.getByText('Family Van')).toBeInTheDocument();
		expect(screen.getByText('Editor · Shared by Alex')).toBeInTheDocument();
	});

	test('an invitation already accepted is not offered again', () => {
		const { container } = mount({
			invitations: [share({ id: 'done', status: 'accepted', vehicleName: 'Old Van' })]
		});
		expect(container.textContent?.trim()).toBe('');
		expect(screen.queryByRole('button', { name: /Accept/ })).toBeNull();
	});

	test('only the pending ones are listed when both kinds come in', () => {
		mount({
			invitations: [
				share({ id: 'done', status: 'accepted', vehicleName: 'Old Van' }),
				share({ id: 'new', status: 'pending', vehicleName: 'Family Van' })
			]
		});
		const list = screen.getByRole('list', { name: 'Invitations to accept' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(1);
		expect(within(list).getByText('Family Van')).toBeInTheDocument();
		expect(screen.queryByText('Old Van')).toBeNull();
	});

	test('a page with its own heading can leave the card title out', () => {
		mount({ title: null });
		expect(screen.queryByText('Shared with you')).toBeNull();
		expect(screen.getByRole('list', { name: 'Invitations to accept' })).toBeInTheDocument();
	});

	test('a load failure shows its message, and Retry asks the page to reload', async () => {
		const { onRetry } = mount({ loadError: 'The server had a problem.' });

		expect(screen.getByText("Couldn't load your invitations")).toBeInTheDocument();
		expect(screen.getByText('The server had a problem.')).toBeInTheDocument();
		expect(screen.queryByText('Family Van')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});
});

describe('SharedWithMeCard accepting and declining', () => {
	test('accepting toasts and hands the invitation to the page', async () => {
		const { onAccepted, onDeclined } = mount();

		await fireEvent.click(screen.getByRole('button', { name: 'Accept access to Family Van' }));
		await settle();

		expect(accept).toHaveBeenCalledWith('s1');
		expect(toastSuccess).toHaveBeenCalledWith('Accepted access to Family Van');
		expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
		expect(onDeclined).not.toHaveBeenCalled();
	});

	test('both buttons are disabled while the action is in flight', async () => {
		accept.mockReturnValue(new Promise(() => {}));
		mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Accept access to Family Van' }));
		await settle();

		expect(screen.getByRole('button', { name: 'Accept access to Family Van' })).toBeDisabled();
		expect(
			screen.getByRole('button', { name: 'Decline the invitation to Family Van' })
		).toBeDisabled();
	});

	test('an API error on accept shows its message and keeps the invitation', async () => {
		accept.mockRejectedValue(new ApiError('Invitation expired', 410));
		const { onAccepted } = mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Accept access to Family Van' }));
		await settle();

		expect(toastError).toHaveBeenCalledWith("Couldn't accept the invitation. Invitation expired.");
		expect(onAccepted).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Accept access to Family Van' })).toBeEnabled();
	});

	test('an unexpected error on accept shows a generic retry message', async () => {
		accept.mockRejectedValue(new TypeError('fetch failed'));
		mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Accept access to Family Van' }));
		await settle();

		expect(toastError).toHaveBeenCalledWith(
			`Couldn't accept the invitation. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
	});

	test('declining toasts and hands the invitation to the page', async () => {
		const { onAccepted, onDeclined } = mount();

		await fireEvent.click(
			screen.getByRole('button', { name: 'Decline the invitation to Family Van' })
		);
		await settle();

		expect(decline).toHaveBeenCalledWith('s1');
		expect(toastSuccess).toHaveBeenCalledWith('Declined the invitation to Family Van');
		expect(onDeclined).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
		expect(onAccepted).not.toHaveBeenCalled();
	});

	test('an API error on decline shows its message', async () => {
		decline.mockRejectedValue(new ApiError('Not found', 404));
		const { onDeclined } = mount();
		await fireEvent.click(
			screen.getByRole('button', { name: 'Decline the invitation to Family Van' })
		);
		await settle();

		expect(toastError).toHaveBeenCalledWith("Couldn't decline the invitation. Not found.");
		expect(onDeclined).not.toHaveBeenCalled();
	});

	test('an unexpected error on decline shows a generic retry message', async () => {
		decline.mockRejectedValue(new TypeError('boom'));
		mount();
		await fireEvent.click(
			screen.getByRole('button', { name: 'Decline the invitation to Family Van' })
		);
		await settle();

		expect(toastError).toHaveBeenCalledWith(
			`Couldn't decline the invitation. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
	});
});
