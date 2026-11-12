import { describe, expect, test } from 'bun:test';
import { deriveImportClientId, type ImportableExpense } from '../import-csv';

function baseExpense(): ImportableExpense {
  return {
    vehicleId: 'veh-1',
    category: 'fuel',
    expenseAmount: 42.5,
    date: new Date('2024-03-15T12:00:00.000Z'),
    mileage: 30_000,
    volume: 11.5,
    fuelType: 'Regular',
    description: 'fill up',
    location: 'Shell, Main St',
    tags: ['road', 'trip'],
    missedFillup: false,
    clientId: '',
  };
}

describe('deriveImportClientId — field sensitivity (the import idempotency-key data-safety contract)', () => {
  test('the prefix is `csv:` (namespaced away from offline cuid clientIds + manual NULLs)', () => {
    expect(deriveImportClientId(baseExpense(), 0).startsWith('csv:')).toBe(true);
  });

  test('derived keys are stable across releases', () => {
    expect(deriveImportClientId(baseExpense(), 0)).toBe('csv:d56062d1b54daf9c876d0d3cce0bd6b0');
    expect(deriveImportClientId(baseExpense(), 1)).toBe('csv:49d036c6bddcbd829bebd2ea4e16478e');
  });

  test('identical content + same occurrence → identical key (deterministic; re-import dedups)', () => {
    expect(deriveImportClientId(baseExpense(), 0)).toBe(deriveImportClientId(baseExpense(), 0));
  });

  test('a different occurrence index → distinct key (two identical rows in one file both import)', () => {
    expect(deriveImportClientId(baseExpense(), 0)).not.toBe(deriveImportClientId(baseExpense(), 1));
  });

  const mutations: Array<{ field: string; mutate: (e: ImportableExpense) => void }> = [
    { field: 'vehicleId', mutate: (e) => (e.vehicleId = 'veh-2') },
    { field: 'category', mutate: (e) => (e.category = 'maintenance') },
    { field: 'expenseAmount', mutate: (e) => (e.expenseAmount = 99.99) },
    { field: 'date', mutate: (e) => (e.date = new Date('2024-03-16T12:00:00.000Z')) },
    { field: 'mileage', mutate: (e) => (e.mileage = 30_001) },
    { field: 'volume', mutate: (e) => (e.volume = 12) },
    { field: 'fuelType', mutate: (e) => (e.fuelType = 'Premium') },
    { field: 'description', mutate: (e) => (e.description = 'different note') },
    { field: 'location', mutate: (e) => (e.location = 'Costco, 2nd Ave') },
    { field: 'tags', mutate: (e) => (e.tags = ['highway']) },
    { field: 'missedFillup', mutate: (e) => (e.missedFillup = true) },
  ];

  for (const { field, mutate } of mutations) {
    test(`changing ${field} flips the key (no silent collision → no dropped row)`, () => {
      const original = deriveImportClientId(baseExpense(), 0);
      const variant = baseExpense();
      mutate(variant);
      expect(
        deriveImportClientId(variant, 0),
        `Two rows differing only in ${field} produced the SAME idempotency key — the second would be ` +
          `silently dropped on import (createIdempotent no-ops the (userId, clientId) collision), losing ` +
          `the user's data. ${field} must be part of deriveImportClientId's content hash.`
      ).not.toBe(original);
    });
  }

  test("a null mileage vs a real mileage → distinct keys (the `?? ''` blank does not swallow a value)", () => {
    const withMileage = deriveImportClientId(baseExpense(), 0);
    const noMileage = baseExpense();
    noMileage.mileage = null;
    expect(deriveImportClientId(noMileage, 0)).not.toBe(withMileage);
  });
});
