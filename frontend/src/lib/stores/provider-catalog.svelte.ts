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
	reenterWhenChanged?: string[];
}

export interface StorageFeatures {
	photoOnly: boolean;
	backupSheets: boolean;
	defaultFolders: Record<PhotoCategory, string>;
	defaultPhotoRootPath: string;
}

interface CatalogEntryBase {
	id: string;
	label: string;
	shortLabel: string;
	description: string;
	scope: 'user' | 'server' | 'builtin';
	connect: 'form' | 'oauth' | 'none';
	fields: ProviderFieldSpec[];
	secrets: ProviderSecretSpec[];
}

export interface StorageCatalogEntry extends CatalogEntryBase {
	capability: 'storage';
	features: StorageFeatures;
}

export type ModelCapability = 'ai.llm' | 'ai.vision';

export interface ModelCatalogEntry extends CatalogEntryBase {
	capability: ModelCapability;
	features: Record<string, never>;
}

export interface AuthCatalogEntry extends CatalogEntryBase {
	capability: 'auth';
	features: { pkce: boolean; verifiedEmail: boolean };
}

export interface ImportCatalogEntry extends CatalogEntryBase {
	capability: 'import';
	features: { accept: string[]; detect: true };
}

export type CatalogEntry =
	StorageCatalogEntry | ModelCatalogEntry | AuthCatalogEntry | ImportCatalogEntry;

function createProviderCatalogStore() {
	let entries = $state<CatalogEntry[] | null>(null);
	let error = $state<string | null>(null);
	let inFlight: Promise<CatalogEntry[]> | null = null;

	async function ensureLoaded(): Promise<CatalogEntry[]> {
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

	function storageEntries(): StorageCatalogEntry[] {
		return (entries ?? []).filter((e): e is StorageCatalogEntry => e.capability === 'storage');
	}

	return {
		get storage() {
			return storageEntries();
		},
		models(capability: ModelCapability): ModelCatalogEntry[] {
			return (entries ?? []).filter((e): e is ModelCatalogEntry => e.capability === capability);
		},
		get error() {
			return error;
		},
		get loaded() {
			return entries !== null;
		},
		storageEntry(providerType: string | null | undefined): StorageCatalogEntry | null {
			return storageEntries().find(e => e.id === providerType) ?? null;
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
