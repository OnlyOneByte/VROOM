import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const { logout, notify } = vi.hoisted(() => ({
	logout: vi.fn<() => Promise<void>>(),
	notify: vi.fn<(error: unknown, context?: string) => void>()
}));

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/stores/auth.svelte.ts', () => ({ authStore: { logout } }));
vi.mock('#lib/utils/error-handling.ts', () => ({ handleErrorWithNotification: notify }));

const DemoBanner = (await import('../DemoBanner.svelte')).default;

const originalLocation = window.location;
const assign = vi.fn<(url: string) => void>();

beforeEach(() => {
	vi.clearAllMocks();
	Object.defineProperty(window, 'location', { configurable: true, value: { assign } });
});

afterEach(() => {
	Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('demo banner', () => {
	test('Leave the demo signs out once, however often it is clicked', async () => {
		logout.mockReturnValue(new Promise(() => {}));
		render(DemoBanner);
		const leave = screen.getByRole('button', { name: 'Leave the demo' });

		await fireEvent.click(leave);
		await fireEvent.click(leave);

		expect(logout).toHaveBeenCalledTimes(1);
		expect(leave).toHaveAttribute('aria-busy', 'true');
	});

	test('a failed sign-out says so and lets the visitor try again', async () => {
		logout.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
		render(DemoBanner);
		const leave = screen.getByRole('button', { name: 'Leave the demo' });

		await fireEvent.click(leave);
		await waitFor(() =>
			expect(notify).toHaveBeenCalledWith(expect.any(Error), 'Couldn’t leave the demo')
		);
		expect(leave).toHaveAttribute('aria-busy', 'false');
		expect(assign).not.toHaveBeenCalled();

		await fireEvent.click(leave);
		expect(logout).toHaveBeenCalledTimes(2);
		await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
	});

	test('announces that it is leaving, in a status that is always there', async () => {
		logout.mockReturnValue(new Promise(() => {}));
		render(DemoBanner);
		const status = screen.getByRole('status');
		expect(status).toHaveTextContent('');

		await fireEvent.click(screen.getByRole('button', { name: 'Leave the demo' }));

		expect(status).toHaveTextContent('Leaving the demo…');
	});

	test('after signing out, the visitor lands back on the landing page', async () => {
		logout.mockResolvedValue(undefined);
		render(DemoBanner);

		await fireEvent.click(screen.getByRole('button', { name: 'Leave the demo' }));

		await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
	});
});
