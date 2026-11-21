import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ browser: false }));

import {
	currentOfflineQueueOwner,
	loadOfflineExpenses,
	saveOfflineExpenses,
	setOfflineQueueOwner,
	type OfflineExpense
} from '../offline-storage';
import { getPlatformInfo, initializePWA, pwaInstallState } from '../pwa';

const ls = (global as unknown as { localStorageMock: { __reset: () => void } }).localStorageMock;

const queued: OfflineExpense = {
	id: 'e1',
	clientId: 'cid-e1',
	vehicleId: 'v1',
	tags: [],
	category: 'misc',
	amount: 5,
	date: '2024-06-01',
	timestamp: 0,
	synced: false,
	version: '3.0'
};

describe('browser-only helpers during server rendering', () => {
	beforeEach(() => {
		ls.__reset();
		vi.mocked(window.addEventListener).mockClear();
		vi.mocked(window.matchMedia).mockClear();
	});

	it('reads no offline queue and refuses to save one', () => {
		localStorage.setItem('vroom_offline_expenses', JSON.stringify([queued]));
		vi.mocked(localStorage.getItem).mockClear();
		vi.mocked(localStorage.setItem).mockClear();

		expect(loadOfflineExpenses()).toEqual([]);
		expect(saveOfflineExpenses([queued])).toBe(false);
		expect(localStorage.getItem).not.toHaveBeenCalled();
		expect(localStorage.setItem).not.toHaveBeenCalled();
	});

	it('records the queue owner without adopting the unscoped queue', () => {
		localStorage.setItem('vroom_offline_expenses', JSON.stringify([queued]));

		setOfflineQueueOwner('alice');

		expect(currentOfflineQueueOwner()).toBe('alice');
		expect(localStorage.removeItem).not.toHaveBeenCalled();
		setOfflineQueueOwner(null);
	});

	it('reports a plain desktop platform', () => {
		expect(getPlatformInfo()).toEqual({
			platform: 'desktop',
			isIOS: false,
			isAndroid: false,
			isChromium: false
		});
	});

	it('does not touch window when initialising the PWA', () => {
		pwaInstallState.isStandalone = false;

		initializePWA();

		expect(window.matchMedia).not.toHaveBeenCalled();
		expect(window.addEventListener).not.toHaveBeenCalled();
		expect(pwaInstallState.isStandalone).toBe(false);
	});
});
