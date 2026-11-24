import {
	Wifi,
	WifiOff,
	RefreshCw,
	CircleCheck,
	CircleAlert,
	Clock,
	ServerOff,
	TriangleAlert
} from '@lucide/svelte';
import type { ProviderStatus, UserProviderInfo } from '#lib/types/common.ts';
import type { BackupConfig } from '#lib/types/settings.ts';

type LucideIcon = typeof Wifi;

interface SyncStatusInfo {
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
	providerNeedsAttention?: boolean;
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

	if (params.providerNeedsAttention) {
		return {
			color: 'text-warning',
			icon: TriangleAlert,
			text: 'A backup provider needs attention'
		};
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

const UNHEALTHY: ReadonlySet<ProviderStatus> = new Set(['needs_reauth', 'error']);

export function backupProviderNeedsAttention(
	providers: Pick<UserProviderInfo, 'id' | 'status'>[],
	backupConfig: BackupConfig | null | undefined
): boolean {
	const settings = backupConfig?.providers ?? {};
	return providers.some(provider => {
		const backup = settings[provider.id];
		return UNHEALTHY.has(provider.status) && !!(backup?.enabled || backup?.sheetsSyncEnabled);
	});
}
