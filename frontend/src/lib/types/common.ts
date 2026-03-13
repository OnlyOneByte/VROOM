import type { Vehicle } from './vehicle.js';

export interface Notification {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
	timestamp?: number;
}

export interface AppState {
	vehicles: Vehicle[];
	selectedVehicle: Vehicle | null;
	notifications: Notification[];
	isLoading: boolean;
	isMobileMenuOpen: boolean;
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

export interface UserProviderInfo {
	id: string;
	domain: string;
	providerType: string;
	displayName: string;
	status: 'active' | 'error' | 'disconnected';
	config: Record<string, unknown>;
	lastSyncAt?: string;
	createdAt: string;
}

export interface OdometerEntry {
	id: string;
	vehicleId: string;
	odometer: number;
	recordedAt: string;
	note?: string;
	linkedEntityType?: string;
	linkedEntityId?: string;
	createdAt: string;
	updatedAt: string;
}
