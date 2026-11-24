import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  catalogKey,
  catalogModel,
  isCatalogModel,
  suggestCatalogModel,
  VEHICLE_CATALOG,
} from '../../../utils/vehicle-catalog';

const makesById = new Map(VEHICLE_CATALOG.makes.map((make) => [make.id, make]));
const modelArb = fc.constantFrom(...VEHICLE_CATALOG.models);
const trimArb = fc.constantFrom('EX', 'LX', 'Si', 'XLT', 'Limited', 'Touring', 'SE');

function makeName(makeId: string): string {
  return makesById.get(makeId)?.name ?? '';
}

function mixCase(text: string, flips: boolean[]): string {
  return [...text]
    .map((ch, i) => (flips[i % flips.length] ? ch.toUpperCase() : ch.toLowerCase()))
    .join('');
}

describe('vehicle catalogue file', () => {
  test('ids are unique, every model names a known make, and its id starts with the make', () => {
    const makeIds = VEHICLE_CATALOG.makes.map((make) => make.id);
    const modelIds = VEHICLE_CATALOG.models.map((model) => model.id);
    expect(new Set(makeIds).size).toBe(makeIds.length);
    expect(new Set(modelIds).size).toBe(modelIds.length);
    for (const model of VEHICLE_CATALOG.models) {
      expect(makesById.has(model.makeId), model.id).toBe(true);
      expect(model.id.startsWith(`${model.makeId}-`), model.id).toBe(true);
    }
  });

  test('no two models of one make share a name or alias key', () => {
    const seen = new Map<string, string>();
    for (const model of VEHICLE_CATALOG.models) {
      for (const label of [model.name, ...model.aliases]) {
        const key = `${model.makeId}|${catalogKey(label)}`;
        expect(seen.get(key) ?? model.id, `${label} in ${model.id}`).toBe(model.id);
        seen.set(key, model.id);
      }
    }
  });

  test('no two makes share a name or alias key', () => {
    const seen = new Map<string, string>();
    for (const make of VEHICLE_CATALOG.makes) {
      for (const label of [make.name, ...make.aliases]) {
        const key = catalogKey(label);
        expect(seen.get(key) ?? make.id, `${label} in ${make.id}`).toBe(make.id);
        seen.set(key, make.id);
      }
    }
  });

  test('the catalogue covers about 60 makes with their common models', () => {
    expect(VEHICLE_CATALOG.makes.length).toBeGreaterThanOrEqual(55);
    for (const make of VEHICLE_CATALOG.makes) {
      const count = VEHICLE_CATALOG.models.filter((model) => model.makeId === make.id).length;
      expect(count, make.id).toBeGreaterThan(0);
      expect(count, make.id).toBeLessThanOrEqual(25);
    }
  });
});

describe('suggestCatalogModel', () => {
  test('every catalogue model matches its own make and name', () => {
    fc.assert(
      fc.property(modelArb, (model) => {
        expect(suggestCatalogModel(makeName(model.makeId), model.name)).toBe(model.id);
      })
    );
  });

  test('case does not matter', () => {
    fc.assert(
      fc.property(modelArb, fc.array(fc.boolean(), { minLength: 1 }), (model, flips) => {
        expect(
          suggestCatalogModel(mixCase(makeName(model.makeId), flips), mixCase(model.name, flips))
        ).toBe(model.id);
      })
    );
  });

  test('punctuation and spacing do not matter', () => {
    const separatorArb = fc.constantFrom('-', ' ', '.', '', '  ', '/');
    fc.assert(
      fc.property(modelArb, separatorArb, (model, sep) => {
        const spaced = model.name.replace(/[^\p{L}\p{N}]+/gu, sep);
        expect(suggestCatalogModel(` ${makeName(model.makeId)}! `, `${spaced}.`)).toBe(model.id);
      })
    );
  });

  test('the make repeated at the start of the model is ignored', () => {
    fc.assert(
      fc.property(modelArb, (model) => {
        const make = makeName(model.makeId);
        expect(suggestCatalogModel(make, `${make} ${model.name}`)).toBe(model.id);
      })
    );
  });

  test('a make typed only into the model field is still recognised', () => {
    fc.assert(
      fc.property(modelArb, (model) => {
        expect(suggestCatalogModel('', `${makeName(model.makeId)} ${model.name}`)).toBe(model.id);
      })
    );
  });

  test('trim words after the model are ignored', () => {
    fc.assert(
      fc.property(modelArb, trimArb, (model, trim) => {
        expect(suggestCatalogModel(makeName(model.makeId), `${model.name} ${trim}`)).toBe(model.id);
      })
    );
  });

  test('a leading model year is ignored', () => {
    fc.assert(
      fc.property(modelArb, fc.integer({ min: 1990, max: 2030 }), (model, year) => {
        expect(suggestCatalogModel(makeName(model.makeId), `${year} ${model.name}`)).toBe(model.id);
      })
    );
  });

  test('unknown makes and models return null', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[q-z]{8,12}$/), (junk) => {
        expect(suggestCatalogModel(junk, junk)).toBeNull();
        expect(suggestCatalogModel('Honda', junk)).toBeNull();
      })
    );
    expect(suggestCatalogModel('', '')).toBeNull();
  });

  test.each([
    ['honda', 'CIVIC EX', 'honda-civic'],
    ['Honda', 'Honda Civic', 'honda-civic'],
    ['', 'honda civic si', 'honda-civic'],
    ['Ford', 'F150 XLT', 'ford-f-150'],
    ['ford', 'f-150', 'ford-f-150'],
    ['Mazda', '3', 'mazda-mazda3'],
    ['Mazda', 'Mazda 3 Touring', 'mazda-mazda3'],
    ['Tesla', 'Model 3 Long Range', 'tesla-model-3'],
    ['Land Rover', 'Range Rover Sport HSE', 'land-rover-range-rover-sport'],
    ['Mercedes', 'C300', 'mercedes-benz-c-class'],
    ['VW', 'golf gti', 'volkswagen-golf'],
    ['Škoda', 'Octavia', 'skoda-octavia'],
  ])('%p %p suggests %p', (make, model, expected) => {
    expect(suggestCatalogModel(make, model)).toBe(expected);
    expect(isCatalogModel(expected)).toBe(true);
  });

  test('a model of a different make is not suggested', () => {
    expect(suggestCatalogModel('Toyota', 'Civic')).toBeNull();
  });

  test('catalogModel looks a model up by id', () => {
    expect(catalogModel('honda-civic')?.name).toBe('Civic');
    expect(catalogModel('nope')).toBeUndefined();
  });
});
