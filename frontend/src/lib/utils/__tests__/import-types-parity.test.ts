import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NATIVE_HEADERS } from '../import-mapping-helpers';

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND_MAPPING_PATH = resolve(
	here,
	'../../../../../backend/src/api/expenses/import-mapping.ts'
);
const FRONTEND_TYPES_PATH = resolve(here, '../../types/import-mapping.ts');

function quoted(text: string): string[] {
	return [...text.matchAll(/'([^']*)'/g)].map(m => m[1] as string);
}

function typeMembers(path: string, name: string): string[] {
	const src = readFileSync(path, 'utf8');
	const body = src.match(new RegExp(`export type ${name} =([^;]*);`))?.[1];
	if (!body) throw new Error(`${name} not found in ${path}`);
	return quoted(body).sort();
}

function backendNativeHeader(): string[] {
	const src = readFileSync(BACKEND_MAPPING_PATH, 'utf8');
	const body = src.match(/const NATIVE_HEADER: NativeField\[\] = \[([\s\S]*?)\];/)?.[1];
	if (!body) throw new Error(`NATIVE_HEADER not found in ${BACKEND_MAPPING_PATH}`);
	return quoted(body);
}

describe('import types parity with the backend', () => {
	it('names the same native CSV fields', () => {
		const backend = typeMembers(BACKEND_MAPPING_PATH, 'NativeField');
		expect(backend.length).toBeGreaterThan(0);
		expect(typeMembers(FRONTEND_TYPES_PATH, 'NativeImportField')).toEqual(backend);
		expect([...backendNativeHeader()].sort()).toEqual(backend);
	});

	it('recognises native files only by columns the backend writes', () => {
		expect(backendNativeHeader()).toEqual(expect.arrayContaining([...NATIVE_HEADERS]));
	});

	it('offers the same date formats', () => {
		const backend = typeMembers(BACKEND_MAPPING_PATH, 'ImportDateFormat');
		expect(backend.length).toBeGreaterThan(0);
		expect(typeMembers(FRONTEND_TYPES_PATH, 'ImportDateFormat')).toEqual(backend);
	});
});
