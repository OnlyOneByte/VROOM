import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
	catalogKey,
	findMake,
	loadVehicleCatalog,
	makeSuggestions,
	modelSuggestions,
	suggestCatalogModel,
	textStillNames
} from '../vehicle-catalog';

const SHARED_CATALOG_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../backend/src/shared-vehicle-catalog.json'
);

const catalog = await loadVehicleCatalog();

describe('vehicle catalogue copy', () => {
	test('matches the catalogue the vehicles API validates against', () => {
		expect(catalog).toEqual(JSON.parse(readFileSync(SHARED_CATALOG_PATH, 'utf8')));
	});
});

describe('vehicle catalogue suggestions', () => {
	test('catalogKey ignores case, accents, spaces and punctuation', () => {
		expect(catalogKey(' Škoda ')).toBe('skoda');
		expect(catalogKey('F-150')).toBe(catalogKey('f150'));
		expect(catalogKey('Mercedes-Benz')).toBe('mercedesbenz');
	});

	test('makes are found by name or alias', () => {
		expect(findMake(catalog, 'vw')?.id).toBe('volkswagen');
		expect(findMake(catalog, 'Chevy')?.id).toBe('chevrolet');
		expect(findMake(catalog, 'Zastava')).toBeUndefined();
		expect(findMake(catalog, '')).toBeUndefined();
	});

	test('prefix matches rank before matches inside a name, and the list is capped', () => {
		expect(makeSuggestions(catalog, 'ford')[0]?.name).toBe('Ford');
		expect(makeSuggestions(catalog, '').length).toBeLessThanOrEqual(8);
		const rover = makeSuggestions(catalog, 'rover').map(make => make.name);
		expect(rover).toContain('Land Rover');
	});

	test('models come only from the typed make, matching aliases too', () => {
		expect(modelSuggestions(catalog, 'Honda', 'civ').map(model => model.id)).toEqual([
			'honda-civic'
		]);
		expect(modelSuggestions(catalog, 'Ford', 'f150')[0]?.id).toBe('ford-f-150');
		expect(modelSuggestions(catalog, 'Zastava', 'yugo')).toEqual([]);
	});

	test('textStillNames accepts the name or an alias under the same make only', () => {
		expect(textStillNames(catalog, 'honda-civic', 'honda', 'CIVIC')).toBe(true);
		expect(textStillNames(catalog, 'mercedes-benz-c-class', 'Mercedes', 'C300')).toBe(true);
		expect(textStillNames(catalog, 'honda-civic', 'Honda', 'Civic EX')).toBe(false);
		expect(textStillNames(catalog, 'honda-civic', 'Toyota', 'Civic')).toBe(false);
		expect(textStillNames(catalog, 'nope', 'Honda', 'Civic')).toBe(false);
	});

	test('suggestCatalogModel finds the model behind trims and a repeated make', () => {
		expect(suggestCatalogModel(catalog, 'Honda', 'Civic EX')?.id).toBe('honda-civic');
		expect(suggestCatalogModel(catalog, 'honda', 'Honda Civic Si')?.id).toBe('honda-civic');
		expect(suggestCatalogModel(catalog, 'Land Rover', 'Range Rover Sport HSE')?.id).toBe(
			'land-rover-range-rover-sport'
		);
		expect(suggestCatalogModel(catalog, 'Honda', 'Mystery')).toBeUndefined();
		expect(suggestCatalogModel(catalog, 'Zastava', 'Civic')).toBeUndefined();
	});
});
