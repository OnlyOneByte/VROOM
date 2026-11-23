import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROVIDER_UI } from '#lib/constants/providers.ts';
import { STORAGE_CATALOG } from '#lib/stores/__tests__/provider-catalog-fixtures.ts';

const BACKEND_REGISTRY_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../backend/src/api/providers/domains/storage/registry.ts'
);

function backendStorageIds(): string[] {
	const src = readFileSync(BACKEND_REGISTRY_PATH, 'utf8');
	const block = src.match(/export const STORAGE_PROVIDERS = \{\n([\s\S]*?)\n\} satisfies/)?.[1];
	if (!block) throw new Error(`STORAGE_PROVIDERS not found in ${BACKEND_REGISTRY_PATH}`);
	return [...block.matchAll(/^ {2}'?([\w-]+)'?:/gm)].map(m => m[1] as string);
}

describe('storage provider UI entries', () => {
	it('gives every backend storage provider an icon', () => {
		const ids = backendStorageIds();
		expect(ids).toEqual(expect.arrayContaining(['google-drive', 'google-photos', 's3', 'fake']));
		for (const id of ids) expect(PROVIDER_UI[id]?.icon, id).toBeDefined();
	});

	it('keeps no UI entry for a provider the backend no longer has', () => {
		expect(Object.keys(PROVIDER_UI).sort()).toEqual(backendStorageIds().sort());
	});

	it('uses only backend provider ids in the test catalog', () => {
		const ids = backendStorageIds();
		for (const entry of STORAGE_CATALOG) expect(ids, entry.id).toContain(entry.id);
	});
});
