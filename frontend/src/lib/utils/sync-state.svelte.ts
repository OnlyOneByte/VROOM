import type { OfflineExpense } from './offline-storage';

export interface SyncConflict {
	id: string;
	localExpense: OfflineExpense;
	serverExpense?: {
		date: string;
		amount: number;
		tags: string[];
		category?: string;
		description?: string;
		volume?: number;
		charge?: number;
	};
	conflictType: 'duplicate' | 'modified' | 'deleted';
	resolution?: 'keep_local' | 'keep_server' | 'merge';
}

export interface SyncConfig {
	maxRetries: number;
	retryDelay: number;
	batchSize: number;
	conflictResolution: 'ask_user' | 'keep_local' | 'keep_server';
}

// --- Sync configuration ---
let _syncConfig = $state<SyncConfig>({
	maxRetries: 3,
	retryDelay: 1000,
	batchSize: 10,
	conflictResolution: 'ask_user'
});

export const syncConfig = {
	get current() {
		return _syncConfig;
	},
	set current(value: SyncConfig) {
		_syncConfig = value;
	},
	update(fn: (config: SyncConfig) => SyncConfig) {
		_syncConfig = fn(_syncConfig);
	}
};

// --- Sync queue ---
let _syncQueue = $state<OfflineExpense[]>([]);

export const syncQueue = {
	get current() {
		return _syncQueue;
	},
	set current(value: OfflineExpense[]) {
		_syncQueue = value;
	}
};

// --- Sync conflicts ---
let _syncConflicts = $state<SyncConflict[]>([]);

export const syncConflicts = {
	get current() {
		return _syncConflicts;
	},
	set current(value: SyncConflict[]) {
		_syncConflicts = value;
	}
};

// --- Timestamps ---
let _lastSyncTime = $state<Date | null>(null);
let _lastBackupTime = $state<Date | null>(null);
let _lastSheetsSync = $state<Date | null>(null);
let _lastDataChangeTime = $state<Date | null>(null);

export const lastSyncTime = {
	get current() {
		return _lastSyncTime;
	},
	set current(value: Date | null) {
		_lastSyncTime = value;
	}
};

export const lastBackupTime = {
	get current() {
		return _lastBackupTime;
	},
	set current(value: Date | null) {
		_lastBackupTime = value;
	}
};

export const lastSheetsSync = {
	get current() {
		return _lastSheetsSync;
	},
	set current(value: Date | null) {
		_lastSheetsSync = value;
	}
};

export const lastDataChangeTime = {
	get current() {
		return _lastDataChangeTime;
	},
	set current(value: Date | null) {
		_lastDataChangeTime = value;
	}
};

// --- Feature flags ---
let _googleDriveBackupEnabled = $state(false);
let _googleSheetsSyncEnabled = $state(false);

export const googleDriveBackupEnabled = {
	get current() {
		return _googleDriveBackupEnabled;
	},
	set current(value: boolean) {
		_googleDriveBackupEnabled = value;
	}
};

export const googleSheetsSyncEnabled = {
	get current() {
		return _googleSheetsSyncEnabled;
	},
	set current(value: boolean) {
		_googleSheetsSyncEnabled = value;
	}
};
