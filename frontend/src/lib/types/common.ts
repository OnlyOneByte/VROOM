import type { Vehicle } from './vehicle.js';

export interface Notification {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
	timestamp?: number;
	urgent?: boolean;
	toastId?: string;
	description?: string;
	action?: { label: string; onClick: () => void };
}

export interface AppState {
	vehicles: Vehicle[];
	notifications: Notification[];
	isLoading: boolean;
}

export interface PaginatedResponse<T> {
	data: T[];
	pagination: {
		totalCount: number;
		limit: number;
		offset: number;
		hasMore: boolean;
	};
}

export interface Photo {
	id: string;
	entityType: string;
	entityId: string;
	fileName: string;
	mimeType: string;
	fileSize: number;
	isCover: boolean;
	sortOrder: number;
	createdAt: string;
}

export type ProviderStatus = 'active' | 'needs_reauth' | 'error' | 'disabled';
export type ProviderHealthCode = 'auth' | 'permission' | 'unreachable' | 'config' | 'endpoint';

export interface ProviderHealthResult {
	ok: boolean;
	code?: ProviderHealthCode;
	message: string;
}

export interface UserProviderInfo {
	id: string;
	domain: string;
	providerType: string;
	displayName: string;
	status: ProviderStatus;
	config: Record<string, unknown>;
	secretsSet?: string[];
	lastSyncAt?: string | null;
	lastErrorCode?: ProviderHealthCode | null;
	lastCheckedAt?: string | null;
	createdAt: string;
}

export interface OdometerEntry {
	id: string;
	vehicleId: string;
	odometer: number;
	recordedAt: string;
	note?: string;
	createdAt: string;
	updatedAt: string;
}

export interface OdometerHistoryEntry {
	odometer: number;
	recordedAt: string;
	source: 'expense' | 'manual';
	sourceId: string;
	note: string | null;
}
