import { afterEach, describe, expect, it } from 'vitest';
import { initializePWA, pwaInstallState } from '../pwa';

describe('initializePWA on an iOS home-screen launch', () => {
	afterEach(() => {
		delete (window.navigator as { standalone?: boolean }).standalone;
		pwaInstallState.isStandalone = false;
		pwaInstallState.isInstalled = false;
	});

	it('treats navigator.standalone as installed when the display-mode query does not match', () => {
		(window.navigator as { standalone?: boolean }).standalone = true;

		initializePWA();

		expect(pwaInstallState.isStandalone).toBe(true);
		expect(pwaInstallState.isInstalled).toBe(true);
	});
});
