import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ELECTRIC_FUEL_TYPES } from '../units';

const BACKEND_TYPES_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../backend/src/db/types.ts'
);

function backendElectricFuelTypes(): string[] {
	const src = readFileSync(BACKEND_TYPES_PATH, 'utf8');
	const match = src.match(/export\s+const\s+ELECTRIC_FUEL_TYPES\s*=\s*\[([\s\S]*?)\]/);
	if (!match?.[1]) throw new Error(`ELECTRIC_FUEL_TYPES not found in ${BACKEND_TYPES_PATH}`);
	return [...match[1].matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2] as string);
}

describe('ELECTRIC_FUEL_TYPES parity with the backend', () => {
	it('lists exactly the backend members, so charge-vs-volume routing agrees on both sides', () => {
		const backend = backendElectricFuelTypes();
		expect(backend.length).toBeGreaterThan(0);
		expect([...ELECTRIC_FUEL_TYPES].sort()).toEqual([...backend].sort());
	});
});
