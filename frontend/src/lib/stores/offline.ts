import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import type { OfflineExpense } from '$lib/utils/offline-storage';

// Online/offline status
export const isOnline = writable(browser ? navigator.onLine : true);

// Offline expense queue
export const offlineExpenses = writable<OfflineExpense[]>([]);

// Sync status
export const syncStatus = writable<'idle' | 'syncing' | 'error' | 'success'>('idle');

// Initialize online/offline detection
if (browser) {
	window.addEventListener('online', () => isOnline.set(true));
	window.addEventListener('offline', () => isOnline.set(false));
}

// Derived store for connection status
export const connectionStatus = derived([isOnline, syncStatus], ([$isOnline, $syncStatus]) => ({
	online: $isOnline,
	syncing: $syncStatus === 'syncing',
	hasOfflineData: false // Will be updated by offline queue
}));
