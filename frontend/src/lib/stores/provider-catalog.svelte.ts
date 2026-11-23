import type { PhotoCategory } from '#lib/types/index.ts';
import { providerApi } from '#lib/services/provider-api.ts';
import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';

export interface ProviderFieldSpec {
	key: string;
	label: string;
	kind: 'text' | 'url' | 'select' | 'number' | 'path';
	required: boolean;
	placeholder?: string;
	help?: string;
	options?: { value: string; label: string }[];
	default?: string | number;
}

export interface ProviderSecretSpec {
	key: string;
	label: string;
	required: boolean;
}

export interface StorageFeatures {
	photoOnly: boolean;
	backupSheets: boolean;
	defaultFolders: Record<PhotoCategory, string>;
	defaultPhotoRootPath: string;
}

export interface StorageCatalogEntry {
	id: string;
	capability: 'storage';
	label: string;
	shortLabel: string;
	description: string;
	scope: 'user' | 'server' | 'builtin';
	connect: 'form' | 'oauth' | 'none';
	fields: ProviderFieldSpec[];
	secrets: ProviderSecretSpec[];
	features: StorageFeatures;
}

function createProviderCatalogStore() {
	let entries = $state<StorageCatalogEntry[] | null>(null);
	let error = $state<string | null>(null);
	let inFlight: Promise<StorageCatalogEntry[]> | null = null;

	async function ensureLoaded(): Promise<StorageCatalogEntry[]> {
		if (entries) return entries;
		inFlight ??= providerApi.getCatalog().finally(() => {
			inFlight = null;
		});
		try {
			entries = await inFlight;
			error = null;
			return entries;
		} catch (err) {
			error = userFacingErrorMessage(err);
			throw err;
		}
	}

	return {
		get entries() {
			return entries ?? [];
		},
		get error() {
			return error;
		},
		get loaded() {
			return entries !== null;
		},
		entry(providerType: string | null | undefined): StorageCatalogEntry | null {
			return entries?.find(e => e.id === providerType) ?? null;
		},
		ensureLoaded,
		load(): Promise<void> {
			return ensureLoaded().then(
				() => undefined,
				() => undefined
			);
		}
	};
}

export const providerCatalog = createProviderCatalogStore();
