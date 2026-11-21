import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const { pwa } = vi.hoisted(() => ({
	pwa: {
		state: { canInstall: false, isInstalled: false, isStandalone: false },
		initializePWA: vi.fn<() => void>(),
		promptInstall: vi.fn<() => Promise<boolean>>()
	}
}));

vi.mock('#lib/utils/pwa.ts', () => ({
	pwaInstallState: pwa.state,
	initializePWA: () => pwa.initializePWA(),
	promptInstall: () => pwa.promptInstall()
}));

const PWAInstallPrompt = (await import('../PWAInstallPrompt.svelte')).default;

async function mountAndWaitForPrompt() {
	const view = render(PWAInstallPrompt);
	await vi.advanceTimersByTimeAsync(1000);
	return view;
}

function heading() {
	return screen.queryByRole('heading', { name: 'Install VROOM' });
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	pwa.state.canInstall = true;
	pwa.state.isInstalled = false;
	pwa.state.isStandalone = false;
	pwa.promptInstall.mockResolvedValue(true);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('PWAInstallPrompt', () => {
	test('is hidden before the first availability check', async () => {
		render(PWAInstallPrompt);
		await vi.advanceTimersByTimeAsync(0);
		expect(pwa.initializePWA).toHaveBeenCalledTimes(1);
		expect(heading()).toBeNull();
	});

	test('appears once the browser can install and the app is not installed', async () => {
		await mountAndWaitForPrompt();
		expect(heading()).toBeInTheDocument();
		expect(screen.getByText(/faster access and offline functionality/)).toBeInTheDocument();
	});

	test('stays hidden when the app is already installed', async () => {
		pwa.state.isInstalled = true;
		await mountAndWaitForPrompt();
		expect(heading()).toBeNull();
	});

	test('stays hidden if install never becomes available within ten seconds', async () => {
		pwa.state.canInstall = false;
		render(PWAInstallPrompt);
		await vi.advanceTimersByTimeAsync(10000);

		pwa.state.canInstall = true;
		await vi.advanceTimersByTimeAsync(2000);

		expect(heading()).toBeNull();
	});

	test('Later dismisses the prompt', async () => {
		await mountAndWaitForPrompt();
		await fireEvent.click(screen.getByRole('button', { name: 'Later' }));
		expect(heading()).toBeNull();
	});

	test('the close button dismisses the prompt', async () => {
		await mountAndWaitForPrompt();
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
		expect(heading()).toBeNull();
	});

	test('an accepted install hides the prompt', async () => {
		await mountAndWaitForPrompt();
		await fireEvent.click(screen.getByRole('button', { name: 'Install' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(pwa.promptInstall).toHaveBeenCalledTimes(1);
		expect(heading()).toBeNull();
	});

	test('a declined install keeps the prompt with Install re-enabled', async () => {
		pwa.promptInstall.mockResolvedValue(false);
		await mountAndWaitForPrompt();
		await fireEvent.click(screen.getByRole('button', { name: 'Install' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(heading()).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled();
	});

	test('shows an installing state while the prompt is open', async () => {
		pwa.promptInstall.mockReturnValue(new Promise(() => {}));
		await mountAndWaitForPrompt();
		await fireEvent.click(screen.getByRole('button', { name: 'Install' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(screen.getByRole('button', { name: /Installing/ })).toBeDisabled();
	});
});
