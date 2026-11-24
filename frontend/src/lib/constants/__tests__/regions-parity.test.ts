import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES, SUBDIVISIONS } from '../regions';

const SHARED_REGIONS_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../backend/src/shared-regions.json'
);

const SHARED = JSON.parse(readFileSync(SHARED_REGIONS_PATH, 'utf8')) as {
	countries: string[];
	subdivisions: Record<string, string>;
};

describe('region list parity with the backend', () => {
	it('offers exactly the countries the settings API accepts', () => {
		expect([...COUNTRY_CODES]).toEqual(SHARED.countries);
	});

	it('offers exactly the subdivisions the settings API accepts, with the same names', () => {
		expect(SUBDIVISIONS).toEqual(SHARED.subdivisions);
	});
});
