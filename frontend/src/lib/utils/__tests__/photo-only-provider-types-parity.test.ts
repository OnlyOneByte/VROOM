import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHOTO_ONLY_PROVIDER_TYPES, supportsZipBackup } from '#lib/constants/providers.ts';

const BACKEND_STRATEGY_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../backend/src/api/sync/backup-strategy.ts'
);

function backendPhotoOnlyTypes(): string[] {
	const src = readFileSync(BACKEND_STRATEGY_PATH, 'utf8');
	const match = src.match(/export\s+const\s+PHOTO_ONLY_PROVIDER_TYPES\s*=\s*\[([\s\S]*?)\]/);
	if (!match?.[1])
		throw new Error(`PHOTO_ONLY_PROVIDER_TYPES not found in ${BACKEND_STRATEGY_PATH}`);
	return [...match[1].matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2] as string);
}

describe('PHOTO_ONLY_PROVIDER_TYPES parity with the backend', () => {
	it('lists exactly the backend members, so the UI hides ZIP backup where the backend ignores it', () => {
		const backend = backendPhotoOnlyTypes();
		expect(backend.length).toBeGreaterThan(0);
		expect([...PHOTO_ONLY_PROVIDER_TYPES].sort()).toEqual([...backend].sort());
	});

	it('offers ZIP backup for file storage providers only', () => {
		expect(supportsZipBackup('google-drive')).toBe(true);
		expect(supportsZipBackup('s3')).toBe(true);
		expect(supportsZipBackup('google-photos')).toBe(false);
		expect(supportsZipBackup(null)).toBe(false);
	});
});
