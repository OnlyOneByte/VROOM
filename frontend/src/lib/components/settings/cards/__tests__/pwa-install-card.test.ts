import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { PlatformInfo } from '#lib/utils/pwa.ts';

const { pwa } = vi.hoisted(() => ({
	pwa: {
		state: { canInstall: false, isInstalled: false, isStandalone: false },
		initializePWA: vi.fn<() => void>(),
		promptInstall: vi.fn<() => Promise<boolean>>(),
		getPlatformInfo: vi.fn<() => PlatformInfo>()
	}
}));

vi.mock('#lib/utils/pwa.ts', () => ({
	pwaInstallState: pwa.state,
	initializePWA: () => pwa.initializePWA(),
	promptInstall: () => pwa.promptInstall(),
	getPlatformInfo: () => pwa.getPlatformInfo()
}));

const PwaInstallCard = (await import('../PwaInstallCard.svelte')).default;

function platform(overrides: Partial<PlatformInfo> = {}): PlatformInfo {
	return { platform: 'desktop', isIOS: false, isAndroid: false, isChromium: false, ...overrides };
}

async function mount() {
	const view = render(PwaInstallCard);
	await vi.advanceTimersByTimeAsync(0);
	return view;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	pwa.state.canInstall = false;
	pwa.state.isInstalled = false;
	pwa.state.isStandalone = false;
	pwa.getPlatformInfo.mockReturnValue(platform());
	pwa.promptInstall.mockResolvedValue(true);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('PwaInstallCard', () => {
	test('initialises PWA detection on mount', async () => {
		await mount();
		expect(pwa.initializePWA).toHaveBeenCalledTimes(1);
	});

	test('in standalone mode it confirms the app is installed', async () => {
		pwa.state.isStandalone = true;
		await mount();
		expect(screen.getByText(/You're using the installed app/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Install VROOM/ })).toBeNull();
	});

	test('when the browser offers install it shows an Install button', async () => {
		pwa.state.canInstall = true;
		await mount();
		expect(screen.getByRole('button', { name: 'Install VROOM' })).toBeEnabled();
	});

	test('an accepted install switches to the installed message', async () => {
		pwa.state.canInstall = true;
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Install VROOM' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(pwa.promptInstall).toHaveBeenCalledTimes(1);
		expect(screen.getByText(/You're using the installed app/)).toBeInTheDocument();
	});

	test('a dismissed install keeps the Install button available', async () => {
		pwa.state.canInstall = true;
		pwa.promptInstall.mockResolvedValue(false);
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Install VROOM' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(screen.getByRole('button', { name: 'Install VROOM' })).toBeEnabled();
		expect(screen.queryByText(/installed app/)).toBeNull();
	});

	test('shows an installing state while the prompt is open', async () => {
		pwa.state.canInstall = true;
		pwa.promptInstall.mockReturnValue(new Promise(() => {}));
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Install VROOM' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(screen.getByRole('button', { name: /Installing/ })).toBeDisabled();
	});

	test('on iOS it says how in one line and keeps the steps behind How it works', async () => {
		pwa.getPlatformInfo.mockReturnValue(platform({ platform: 'ios', isIOS: true }));
		const { container } = await mount();
		expect(screen.getByText(/In Safari, tap/)).toBeInTheDocument();
		const details = container.querySelector('details');
		expect(details).not.toBeNull();
		expect(details?.open).toBe(false);
		expect(details?.querySelector('summary')).toHaveTextContent('How it works');
		expect(details?.querySelectorAll('ol li')).toHaveLength(3);
		expect(screen.queryByRole('button')).toBeNull();
	});

	test('on Chromium without a prompt it points at the address-bar install icon', async () => {
		pwa.getPlatformInfo.mockReturnValue(platform({ isChromium: true }));
		await mount();
		expect(screen.getByText(/Use the install icon/)).toBeInTheDocument();
	});

	test('on other browsers it recommends Chrome or Edge', async () => {
		await mount();
		expect(screen.getByText(/to install it\./)).toBeInTheDocument();
	});

	test('picks up an install prompt that arrives after mount', async () => {
		await mount();
		expect(screen.queryByRole('button', { name: 'Install VROOM' })).toBeNull();

		pwa.state.canInstall = true;
		await vi.advanceTimersByTimeAsync(500);

		expect(screen.getByRole('button', { name: 'Install VROOM' })).toBeInTheDocument();
	});

	test('picks up standalone mode that is detected after mount', async () => {
		await mount();
		pwa.state.isStandalone = true;
		await vi.advanceTimersByTimeAsync(500);
		expect(screen.getByText(/You're using the installed app/)).toBeInTheDocument();
	});

	test('stops polling after five seconds', async () => {
		await mount();
		await vi.advanceTimersByTimeAsync(5000);

		pwa.state.canInstall = true;
		await vi.advanceTimersByTimeAsync(1000);

		expect(screen.queryByRole('button', { name: 'Install VROOM' })).toBeNull();
	});
});
