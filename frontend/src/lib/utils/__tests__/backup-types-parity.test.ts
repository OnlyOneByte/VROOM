import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND_TYPES = resolve(here, '../../../../../backend/src/types.ts');
const FRONTEND_TYPES = resolve(here, '../../types/settings.ts');
const SHARED = [
	'ProviderBackupSettings',
	'BackupConfig',
	'BackupFileInfo',
	'ProviderBackupList'
] as const;

function fields(path: string, name: string): string[] {
	const src = readFileSync(path, 'utf8');
	const body = src.match(new RegExp(`export interface ${name} \\{([^}]*)\\}`))?.[1];
	if (!body) throw new Error(`${name} not found in ${path}`);
	return body
		.split('\n')
		.map(line => line.trim().match(/^(\w+)(\??):\s*(.+?);?$/))
		.filter(match => match !== null)
		.map(([, key, optional, type]) => `${key}${optional}: ${type}`)
		.sort();
}

describe('backup types parity with the backend', () => {
	it.each(SHARED)('%s has the same fields, optionality and types on both sides', name => {
		const backend = fields(BACKEND_TYPES, name);
		expect(backend.length).toBeGreaterThan(0);
		expect(fields(FRONTEND_TYPES, name)).toEqual(backend);
	});
});
