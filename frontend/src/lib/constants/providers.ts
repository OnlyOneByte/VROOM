import type { Component } from 'svelte';
import { Cloud, Database, FlaskConical, Image } from '@lucide/svelte';
import type { PhotoCategory, CategorySetting } from '#lib/types/index.ts';
import type { GoogleOAuthReturn } from '#lib/components/settings/storage-provider/use-google-oauth.svelte.ts';
import GoogleDriveForm from '#lib/components/settings/storage-provider/form/GoogleDriveForm.svelte';
import { providerCatalog } from '#lib/stores/provider-catalog.svelte.ts';

export interface ProviderConnection {
	ready: boolean;
	config: Record<string, unknown>;
	credentials: Record<string, unknown>;
	nonce?: string | undefined;
}

export interface ProviderFormProps {
	existingConfig: Record<string, unknown> | undefined;
	isEditMode: boolean;
	providerLabel: string;
	providerIcon: Component<Record<string, unknown>>;
	supportsBackups: boolean;
	oauth: GoogleOAuthReturn;
	connection: ProviderConnection;
}

export interface ProviderFormMeta {
	component: Component<ProviderFormProps, Record<string, never>, 'connection'>;
	description: string;
}

export interface ProviderUi {
	icon: Component<Record<string, unknown>>;
	form?: ProviderFormMeta;
	fallbackLabel?: string;
}

export const PROVIDER_UI: Record<string, ProviderUi> = {
	'google-drive': {
		icon: Cloud,
		form: { component: GoogleDriveForm, description: 'Google Drive connection' }
	},
	'google-photos': {
		icon: Image,
		form: { component: GoogleDriveForm, description: 'Google Photos connection' },
		fallbackLabel: 'Google Photos'
	},
	s3: { icon: Database },
	fake: { icon: FlaskConical }
};

export function providerUi(providerType: string | null | undefined): ProviderUi | null {
	return providerType && Object.hasOwn(PROVIDER_UI, providerType)
		? (PROVIDER_UI[providerType] ?? null)
		: null;
}

export function providerLabel(providerType: string): string {
	return (
		providerCatalog.storageEntry(providerType)?.label ??
		providerUi(providerType)?.fallbackLabel ??
		providerType
	);
}

export function supportsZipBackup(providerType: string | null | undefined): boolean {
	return providerCatalog.storageEntry(providerType)?.features.photoOnly === false;
}

export function supportsSheetsBackup(providerType: string | null | undefined): boolean {
	return providerCatalog.storageEntry(providerType)?.features.backupSheets === true;
}

export function providerDetails(
	providerType: string,
	config: Record<string, unknown>
): { label: string; value: string }[] {
	return (providerCatalog.storageEntry(providerType)?.fields ?? []).map(field => ({
		label: field.label,
		value: (config[field.key] as string | undefined) ?? '—'
	}));
}

export function defaultFolderSettings(
	providerType: string | null | undefined
): Record<PhotoCategory, CategorySetting> {
	const folders = providerCatalog.storageEntry(providerType)?.features.defaultFolders ?? {};
	return Object.fromEntries(
		Object.entries(folders).map(([category, folderPath]) => [
			category,
			{ enabled: true, folderPath }
		])
	) as Record<PhotoCategory, CategorySetting>;
}
