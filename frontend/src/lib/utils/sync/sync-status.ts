import {
	Wifi,
	WifiOff,
	RefreshCw,
	CircleCheck,
	CircleAlert,
	Clock,
	ServerOff
} from '@lucide/svelte';

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
	serverReachable: boolean;
}

export function getSyncStatusInfo(params: SyncStatusParams): SyncStatusInfo {
	const { isOnline, syncStatus, pendingCount, conflictsCount, serverReachable } = params;

	if (!isOnline) {
		return { color: 'text-destructive', icon: WifiOff, text: 'Offline' };
	}

	if (!serverReachable) {
		return { color: 'text-warning', icon: ServerOff, text: "Can't reach VROOM" };
	}

	if (conflictsCount > 0) {
		return {
			color: 'text-warning',
			icon: CircleAlert,
			text: `${conflictsCount} conflict${conflictsCount > 1 ? 's' : ''}`
		};
	}

	if (syncStatus === 'syncing') {
		return { color: 'text-warning', icon: RefreshCw, text: 'Syncing...' };
	}

	if (syncStatus === 'error') {
		return { color: 'text-destructive', icon: CircleAlert, text: 'Sync failed' };
	}

	if (syncStatus === 'success') {
		return { color: 'text-success', icon: CircleCheck, text: 'Synced' };
	}

	if (pendingCount > 0) {
		return {
			color: 'text-warning',
			icon: Clock,
			text: `${pendingCount} pending`
		};
	}

	return { color: 'text-success', icon: Wifi, text: 'Up to date' };
}
