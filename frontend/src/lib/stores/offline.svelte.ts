import { browser } from '$app/environment';
import type { OfflineExpense } from '$lib/utils/offline-storage';

let _isOnline = $state(browser ? navigator.onLine : true);

export const onlineStatus = {
	get current() {
		return _isOnline;
	},
	set current(value: boolean) {
		_isOnline = value;
	}
};

if (browser) {
	window.addEventListener('online', () => {
		_isOnline = true;
	});
	window.addEventListener('offline', () => {
		_isOnline = false;
	});
}

let _offlineExpenses = $state<OfflineExpense[]>([]);

export const offlineExpenseQueue = {
	get current() {
		return _offlineExpenses;
	},
	set current(value: OfflineExpense[]) {
		_offlineExpenses = value;
	}
};

let _syncStatus = $state<'idle' | 'syncing' | 'error' | 'success'>('idle');

export const syncState = {
	get current() {
		return _syncStatus;
	},
	set current(value: 'idle' | 'syncing' | 'error' | 'success') {
		_syncStatus = value;
	}
};
