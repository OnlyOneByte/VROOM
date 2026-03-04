import { browser } from '$app/environment';
import type { OfflineExpense } from '$lib/utils/offline-storage';

// --- Online/offline status ---
let _isOnline = $state(browser ? navigator.onLine : true);

export const onlineStatus = {
	get current() {
		return _isOnline;
	},
	set current(value: boolean) {
		_isOnline = value;
	}
};

// Initialize online/offline detection
if (browser) {
	window.addEventListener('online', () => {
		_isOnline = true;
	});
	window.addEventListener('offline', () => {
		_isOnline = false;
	});
}

// --- Offline expense queue ---
let _offlineExpenses = $state<OfflineExpense[]>([]);

export const offlineExpenseQueue = {
	get current() {
		return _offlineExpenses;
	},
	set current(value: OfflineExpense[]) {
		_offlineExpenses = value;
	}
};

// --- Sync status ---
let _syncStatus = $state<'idle' | 'syncing' | 'error' | 'success'>('idle');

export const syncState = {
	get current() {
		return _syncStatus;
	},
	set current(value: 'idle' | 'syncing' | 'error' | 'success') {
		_syncStatus = value;
	}
};

// --- Derived connection status ---
export const connectionStatus = {
	get online() {
		return _isOnline;
	},
	get syncing() {
		return _syncStatus === 'syncing';
	},
	get hasOfflineData() {
		return false;
	}
};
