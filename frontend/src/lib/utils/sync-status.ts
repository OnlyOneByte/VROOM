import type { ComponentType } from 'svelte';
import { Wifi, WifiOff, RefreshCw, CircleCheck, CircleAlert, Clock } from 'lucide-svelte';

export interface SyncStatusInfo {
	color: string;
	icon: ComponentType;
	text: string;
}

export interface SyncStatusParams {
	isOnline: boolean;
	syncStatus: 'idle' | 'syncing' | 'error' | 'success';
	pendingCount: number;
	conflictsCount: number;
}

/**
 * Get sync status information for display
 * Centralized logic used across SyncStatusIndicator and SyncStatusInline
 */
export function getSyncStatusInfo(params: SyncStatusParams): SyncStatusInfo {
	const { isOnline, syncStatus, pendingCount, conflictsCount } = params;

	if (!isOnline) {
		return { color: 'text-red-500', icon: WifiOff, text: 'Offline' };
	}

	if (conflictsCount > 0) {
		return {
			color: 'text-orange-500',
			icon: CircleAlert,
			text: `${conflictsCount} conflict${conflictsCount > 1 ? 's' : ''}`
		};
	}

	if (syncStatus === 'syncing') {
		return { color: 'text-yellow-500', icon: RefreshCw, text: 'Syncing...' };
	}

	if (syncStatus === 'error') {
		return { color: 'text-red-500', icon: CircleAlert, text: 'Sync failed' };
	}

	if (syncStatus === 'success') {
		return { color: 'text-green-500', icon: CircleCheck, text: 'Synced' };
	}

	if (pendingCount > 0) {
		return {
			color: 'text-yellow-500',
			icon: Clock,
			text: `${pendingCount} pending`
		};
	}

	return { color: 'text-green-500', icon: Wifi, text: 'Up to date' };
}
