import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { providerMeta, supportsZipBackup } from '#lib/constants/providers.ts';

const BACKEND_REGISTRY_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../backend/src/api/providers/domains/storage/registry.ts'
);

function backendDescriptors(): Map<string, string> {
	const src = readFileSync(BACKEND_REGISTRY_PATH, 'utf8');
	const block = src.match(/export const STORAGE_PROVIDERS = \{\n([\s\S]*?)\n\} satisfies/)?.[1];
	if (!block) throw new Error(`STORAGE_PROVIDERS not found in ${BACKEND_REGISTRY_PATH}`);
	const entries = [...block.matchAll(/^ {2}'?([\w-]+)'?: \{\n([\s\S]*?)^ {2}\},?$/gm)];
	return new Map(entries.map(([, type, body]) => [type as string, body as string]));
}

describe('photoOnly parity with the backend storage descriptors', () => {
	it('marks exactly the backend photo-only types, so the UI hides ZIP backup where the backend ignores it', () => {
		const descriptors = backendDescriptors();
		expect([...descriptors.keys()]).toEqual(
			expect.arrayContaining(['google-drive', 'google-photos', 's3'])
		);
		for (const [type, body] of descriptors) {
			const backendPhotoOnly = /^\s+photoOnly: true,$/m.test(body);
			expect(providerMeta(type)?.photoOnly ?? false, type).toBe(backendPhotoOnly);
		}
	});

	it('offers ZIP backup for file storage providers only', () => {
		expect(supportsZipBackup('google-drive')).toBe(true);
		expect(supportsZipBackup('s3')).toBe(true);
		expect(supportsZipBackup('google-photos')).toBe(false);
		expect(supportsZipBackup(null)).toBe(false);
	});
});
