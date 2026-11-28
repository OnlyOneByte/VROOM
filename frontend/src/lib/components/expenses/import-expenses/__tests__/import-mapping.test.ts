import { describe, expect, test } from 'vitest';
import {
	assignedCategoryMap,
	buildImportMapping,
	definedColumns,
	type ManualMappingInput,
	type MappingInput,
	type TargetVehicle
} from '../import-mapping';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';

const civic: TargetVehicle = { id: 'civic-1' };

const fuellyPreset: DetectedImportFormat = {
	id: 'fuelly',
	label: 'Fuelly'
};

const manualBase: ManualMappingInput = {
	enabled: true,
	columns: { date: 'Date', amount: 'Total', vehicle: 'Car' },
	dateFormat: 'dmy',
	distanceUnit: 'kilometers',
	volumeUnit: 'liters'
};

function input(overrides: Partial<MappingInput> = {}): MappingInput {
	return {
		preset: null,
		targetVehicle: undefined,
		manual: manualBase,
		categoryRemap: {},
		...overrides
	};
}

describe('definedColumns', () => {
	test('drops unset and empty header entries so they never reach the server', () => {
		expect(definedColumns({ date: 'Date', amount: '', mileage: undefined, tags: 'Tags' })).toEqual({
			date: 'Date',
			tags: 'Tags'
		});
	});
});

describe('assignedCategoryMap', () => {
	test('keeps only words that have a category chosen', () => {
		expect(assignedCategoryMap({ gas: 'fuel', misc: undefined })).toEqual({ gas: 'fuel' });
	});
});

describe('buildImportMapping', () => {
	test('a detected preset plus a target vehicle maps via the preset, merging the user remap', () => {
		const mapping = buildImportMapping(
			input({
				preset: fuellyPreset,
				targetVehicle: civic,
				manual: { ...manualBase, enabled: false },
				categoryRemap: { gas: 'fuel' }
			})
		);

		expect(mapping).toEqual({
			source: 'fuelly',
			columns: {},
			targetVehicle: 'civic-1',
			dateFormat: 'iso',
			categoryMap: { gas: 'fuel' }
		});
	});

	test('a detected preset without a target vehicle is not yet mappable', () => {
		expect(
			buildImportMapping(input({ preset: fuellyPreset, manual: { ...manualBase, enabled: false } }))
		).toBeNull();
	});

	test('a manual mapping with date, amount and a vehicle column needs no target vehicle', () => {
		const mapping = buildImportMapping(input({ targetVehicle: undefined }));

		expect(mapping).toEqual({
			columns: { date: 'Date', amount: 'Total', vehicle: 'Car' },
			dateFormat: 'dmy',
			defaultCategory: 'misc'
		});
		expect(mapping).not.toHaveProperty('targetVehicle');
	});

	test('a manual mapping with no category column files rows as misc; a mapped one sends no default', () => {
		expect(buildImportMapping(input())).toMatchObject({ defaultCategory: 'misc' });
		expect(
			buildImportMapping(
				input({ manual: { ...manualBase, columns: { ...manualBase.columns, category: 'Type' } } })
			)
		).not.toHaveProperty('defaultCategory');
	});

	test('a manual mapping without a vehicle column stamps the picked vehicle id on every row', () => {
		const mapping = buildImportMapping(
			input({
				targetVehicle: civic,
				manual: { ...manualBase, columns: { date: 'Date', amount: 'Total' } }
			})
		);

		expect(mapping).toEqual({
			columns: { date: 'Date', amount: 'Total' },
			dateFormat: 'dmy',
			defaultCategory: 'misc',
			targetVehicle: 'civic-1'
		});
	});

	test('a manual mapping without a vehicle column and without a target vehicle is not mappable', () => {
		expect(
			buildImportMapping(
				input({ manual: { ...manualBase, columns: { date: 'Date', amount: 'Total' } } })
			)
		).toBeNull();
	});

	test.each([
		['date', { ...manualBase.columns, date: undefined }],
		['amount', { ...manualBase.columns, amount: '' }]
	])('a manual mapping missing the required %s column is not mappable', (_field, columns) => {
		expect(buildImportMapping(input({ manual: { ...manualBase, columns } }))).toBeNull();
	});

	test('a manual mapping that is not enabled is not mappable even when its columns are complete', () => {
		expect(buildImportMapping(input({ manual: { ...manualBase, enabled: false } }))).toBeNull();
	});

	test('unit settings are only sent for the columns they describe', () => {
		const withoutUnitColumns = buildImportMapping(input());
		expect(withoutUnitColumns).not.toHaveProperty('distanceUnit');
		expect(withoutUnitColumns).not.toHaveProperty('volumeUnit');

		const withUnitColumns = buildImportMapping(
			input({
				manual: {
					...manualBase,
					columns: { ...manualBase.columns, mileage: 'Odo', volume: 'Gal' }
				}
			})
		);
		expect(withUnitColumns).toMatchObject({ distanceUnit: 'kilometers', volumeUnit: 'liters' });
	});

	test('the category map is sent only once a remap exists, ignoring cleared selections', () => {
		expect(buildImportMapping(input({ categoryRemap: {} }))).not.toHaveProperty('categoryMap');
		expect(buildImportMapping(input({ categoryRemap: { gas: undefined } }))).not.toHaveProperty(
			'categoryMap'
		);
		expect(buildImportMapping(input({ categoryRemap: { gas: 'fuel' } }))).toMatchObject({
			categoryMap: { gas: 'fuel' }
		});
	});
});
