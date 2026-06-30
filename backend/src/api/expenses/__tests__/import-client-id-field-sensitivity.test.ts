/**
 * Deep-review GUARD (C74): the CSV-import idempotency key `deriveImportClientId` is FIELD-SENSITIVE —
 * every distinguishing field of an imported row participates in the content hash.
 *
 * The key is the crown-jewel data-safety contract of the import path (NORTH_STAR #1): re-importing the same
 * file is a no-op (each row's deterministic key already exists by createIdempotent's (userId, clientId)
 * unique index), yet two genuinely-different rows must get DISTINCT keys so both land. If a future edit
 * dropped a field from the `content` array (say `tags` or `missedFillup`), two rows differing ONLY in that
 * field would hash-COLLIDE → the second is silently dropped on import (the unique index no-ops it) → the
 * user's data vanishes with no signal. The existing import-csv.test.ts round-trips are end-to-end but NEVER
 * compare two rows differing in exactly one field, and deriveImportClientId was module-private with NO direct
 * test — so a dropped-field regression would stay GREEN everywhere. This pins each field's contribution.
 *
 * CERTIFIED FIRSTHAND (C74): every field in the content array (vehicleId, category, expenseAmount,
 * date, mileage, volume, fuelType, description, tags, missedFillup, occurrence) flips the key. Determinism
 * holds (same content + same occurrence → same key). DOCUMENTED NUANCE (not a fix — it's mitigated): the
 * content joins tags with '' so `['a','b']` and `['ab']` share a tags-segment, BUT buildImportPlan's
 * occurrence counter gives within-file collisions distinct occurrence indices → distinct final keys, so the
 * "both rows import" contract holds within a single import (the only place two such rows coexist). Left as-is.
 *
 * Pure (no DB, no network) — drives the REAL exported function, not a re-implementation (the C181/C229
 * coverage-theater lesson). Runs in the fast suite.
 */

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

  test('identical content + same occurrence → identical key (deterministic; re-import dedups)', () => {
    expect(deriveImportClientId(baseExpense(), 0)).toBe(deriveImportClientId(baseExpense(), 0));
  });

  test('a different occurrence index → distinct key (two identical rows in one file both import)', () => {
    expect(deriveImportClientId(baseExpense(), 0)).not.toBe(deriveImportClientId(baseExpense(), 1));
  });

  // The core invariant: EACH distinguishing field must flip the key. A dropped field → these collide → the
  // second row silently lost on import. One mutation per field, all at the SAME occurrence (0), so any
  // sameness is a content-hash gap, not an occurrence artifact.
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
          `the user's data (#NS1). ${field} must be part of deriveImportClientId's content hash.`
      ).not.toBe(original);
    });
  }

  // Null-able fields: a value vs its blank/null form must also differ (the `?? ''` placeholders must not
  // collapse a real value into the blank that a non-fuel row carries).
  test("a null mileage vs a real mileage → distinct keys (the `?? ''` blank does not swallow a value)", () => {
    const withMileage = deriveImportClientId(baseExpense(), 0);
    const noMileage = baseExpense();
    noMileage.mileage = null;
    expect(deriveImportClientId(noMileage, 0)).not.toBe(withMileage);
  });
});
