import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROVIDER_META, providerMeta, supportsZipBackup } from '#lib/constants/providers.ts';

const BACKEND_REGISTRY_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../backend/src/api/providers/domains/storage/registry.ts'
);

function backendDescriptors(): Map<string, string> {
	const src = readFileSync(BACKEND_REGISTRY_PATH, 'utf8');
	const block = src.match(/export const STORAGE_PROVIDERS = \{\n([\s\S]*?)\n\} satisfies/)?.[1];
	if (!block) throw new Error(`STORAGE_PROVIDERS not found in ${BACKEND_REGISTRY_PATH}`);
	const entries = [...block.matchAll(/^ {2}'?([\w-]+)'?: \{\n([\s\S]*?)^ {2}\},?$/gm)];
	const descriptors = new Map(entries.map(([, type, body]) => [type as string, body as string]));
	const topLevelKeys = [...block.matchAll(/^ {2}'?([\w-]+)'?:/gm)].map(m => m[1]);
	expect([...descriptors.keys()], 'every descriptor must be an inline object').toEqual(
		topLevelKeys
	);
	return descriptors;
}

describe('PROVIDER_META parity with the backend storage descriptors', () => {
	it('marks exactly the backend photo-only types, so the UI hides ZIP backup where the backend ignores it', () => {
		const descriptors = backendDescriptors();
		expect([...descriptors.keys()]).toEqual(
			expect.arrayContaining(['google-drive', 'google-photos', 's3'])
		);
		for (const [type, body] of descriptors) {
			const backendPhotoOnly = /^\s+photoOnly:\s*true\b/m.test(body);
			expect(providerMeta(type)?.photoOnly ?? false, type).toBe(backendPhotoOnly);
		}
	});

	it('seeds each type the form can create with the backend default folders', () => {
		const src = readFileSync(BACKEND_REGISTRY_PATH, 'utf8');
		const folderMap = (text: string): Record<string, string> =>
			Object.fromEntries(
				[...text.matchAll(/(\w+): '([^']*)'/g)].map(([, key, value]) => [key, value])
			);
		const backendFolders = (body: string): Record<string, string> => {
			const inline = body.match(/defaultFolders: \{([\s\S]*?)\}/)?.[1];
			if (inline) return folderMap(inline);
			const name = body.match(/defaultFolders: (\w+),/)?.[1];
			const shared =
				name && src.match(new RegExp(`const ${name}\\b[^=]*= \\{([\\s\\S]*?)\\};`))?.[1];
			if (!shared) throw new Error('defaultFolders not readable');
			return folderMap(shared);
		};
		const creatable = Object.entries(PROVIDER_META).filter(([, meta]) => meta.option);
		expect(creatable.length).toBeGreaterThan(0);
		const descriptors = backendDescriptors();
		for (const [type, meta] of creatable) {
			const body = descriptors.get(type);
			expect(body, type).toBeDefined();
			expect(meta.defaultFolders, type).toEqual(backendFolders(body as string));
		}
	});

	it('offers ZIP backup for file storage providers only', () => {
		expect(supportsZipBackup('google-drive')).toBe(true);
		expect(supportsZipBackup('s3')).toBe(true);
		expect(supportsZipBackup('google-photos')).toBe(false);
		expect(supportsZipBackup(null)).toBe(false);
	});
});
