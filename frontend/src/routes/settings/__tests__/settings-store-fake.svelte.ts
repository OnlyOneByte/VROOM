import { vi } from 'vitest';
import type { UserSettings } from '#lib/types/index.ts';

export const fakeSettingsState = $state<{
	settings: UserSettings | null;
	isLoading: boolean;
	error: string | null;
}>({ settings: null, isLoading: false, error: null });

export const settingsStoreFake = {
	get settings() {
		return fakeSettingsState.settings;
	},
	get isLoading() {
		return fakeSettingsState.isLoading;
	},
	get error() {
		return fakeSettingsState.error;
	},
	load: vi.fn<() => Promise<void>>(),
	update: vi.fn<(updates: Partial<UserSettings>) => Promise<UserSettings>>(),
	downloadBackup: vi.fn<() => Promise<void>>(),
	executeSync: vi.fn()
};
