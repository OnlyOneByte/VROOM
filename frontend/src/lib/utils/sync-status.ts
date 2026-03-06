import { Wifi, WifiOff, RefreshCw, CircleCheck, CircleAlert, Clock } from 'lucide-svelte';

type LucideIcon = typeof Wifi;

export interface SyncStatusInfo {
	color: string;
	icon: LucideIcon;
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
		return { color: 'text-destructive', icon: WifiOff, text: 'Offline' };
	}

	if (conflictsCount > 0) {
		return {
			color: 'text-chart-5',
			icon: CircleAlert,
			text: `${conflictsCount} conflict${conflictsCount > 1 ? 's' : ''}`
		};
	}

	if (syncStatus === 'syncing') {
		return { color: 'text-chart-5', icon: RefreshCw, text: 'Syncing...' };
	}

	if (syncStatus === 'error') {
		return { color: 'text-destructive', icon: CircleAlert, text: 'Sync failed' };
	}

	if (syncStatus === 'success') {
		return { color: 'text-chart-2', icon: CircleCheck, text: 'Synced' };
	}

	if (pendingCount > 0) {
		return {
			color: 'text-chart-5',
			icon: Clock,
			text: `${pendingCount} pending`
		};
	}

	return { color: 'text-chart-2', icon: Wifi, text: 'Up to date' };
}
