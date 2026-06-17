/**
 * DRIFT GUARD (C3, deep-review): the set of "photographable" entity types is duplicated across THREE
 * independent code paths that MUST stay in sync, and today are held together only by code comments:
 *
 *   1. `validateEntityOwnership` (photos/helpers.ts)      — the upload gate (which types may be uploaded)
 *   2. `validatePhotoRefs` entityTypeToIds (sync/backup.ts) — the RESTORE validator (which types a backup
 *                                                             may legally contain)
 *   3. `ENTITY_TO_CATEGORY` (storage-provider.ts)          — provider routing (entity → storage category)
 *
 * The crown-jewel failure this guards (NORTH_STAR #1): when `insurance_claim` was added to the upload
 * gate but MISSED in the backup validator's map (C404), a perfectly valid backup containing a claim photo
 * failed `validatePhotoRefs` ("unknown entity type") → valid:false → the WHOLE restore aborted, so the
 * user couldn't recover ANY of their own data. The reactive fix added the one missing key; this guard
 * makes the THREE allowlists provably equal so the next new photographable type (e.g. a future `trip`)
 * can't silently re-introduce the drift — adding it to the upload gate/category map without the backup
 * map will go RED here instead of bricking a restore in production.
 *
 * `ENTITY_TO_CATEGORY` is the canonical, EXPORTED source — both other sites are asserted against its keys.
 * The guard drives the REAL modules (validateBackupData + validateEntityOwnership), never a re-implementation.
 *
 * createTestApp() rewrites env + dynamic-imports DB-bound modules, so keep static imports type-only
 * where they pull in config/connection (mirrors the sibling backup/HTTP-harness tests).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { photos, vehicles } from '../../../db/schema';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import type { ParsedBackupData } from '../../../types';
import { validateEntityOwnership } from '../../photos/helpers';
import { ENTITY_TO_CATEGORY } from '../../providers/domains/storage/storage-provider';
import { backupService, coerceRow } from '../backup';

/** The canonical photographable entity types — the ONE source of truth both other sites must match. */
const PHOTO_ENTITY_TYPES = Object.keys(ENTITY_TO_CATEGORY);

/** Default string values by SQLite column type (mimics CSV output) — mirrors backup.test.ts. */
const COLUMN_TYPE_DEFAULTS: Record<string, string> = {
  SQLiteTimestamp: '2025-01-15T00:00:00.000Z',
  SQLiteInteger: '100',
  SQLiteReal: '50.00',
  SQLiteBoolean: 'false',
  SQLiteTextJson: '[]',
};

/** Build a minimal CSV-like row (all string values) for a table, then coerce to JS types. */
function buildRow(
  table: Parameters<typeof getTableColumns>[0],
  overrides: Record<string, string> = {}
): Record<string, string> {
  const columns = getTableColumns(table);
  const row: Record<string, string> = {};
  for (const [name, col] of Object.entries(columns)) {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle column type not fully exposed
    const c = col as any;
    if (overrides[name] !== undefined) row[name] = overrides[name];
    else if (COLUMN_TYPE_DEFAULTS[c.columnType]) row[name] = COLUMN_TYPE_DEFAULTS[c.columnType];
    else if (c.enumValues && c.enumValues.length > 0) row[name] = c.enumValues[0];
    else row[name] = `test-${name}`;
  }
  return row;
}

function emptyBackup(userId: string): ParsedBackupData {
  return {
    metadata: { version: '1.0.0', timestamp: new Date().toISOString(), userId },
    vehicles: [],
    expenses: [],
    financing: [],
    insurance: [],
    insuranceTerms: [],
    insuranceTermVehicles: [],
    insuranceClaims: [],
    userPreferences: [],
    syncState: [],
    photos: [],
    odometer: [],
    photoRefs: [],
    reminders: [],
    reminderVehicles: [],
    reminderNotifications: [],
  } as ParsedBackupData;
}

describe('photo entity-type allowlist sync (#C404 drift guard)', () => {
  // --- 1. The RESTORE validator must accept every canonical photo entity type --------------------
  // A photo of any ENTITY_TO_CATEGORY type, pointed at a row that EXISTS in the backup, must NOT trip
  // validatePhotoRefs' "unknown entity type" branch — that branch aborts the whole restore (C404). We
  // assert specifically the unknown-type error is absent (a "references non-existent" error from a
  // seeding gap would be a test bug, not the drift this guards — so we seed the target row per type).
  for (const entityType of PHOTO_ENTITY_TYPES) {
    test(`restore validator recognizes photo entityType "${entityType}" (no unknown-type abort)`, () => {
      const backup = emptyBackup('u1');
      // Seed a same-id target row in the matching table so the referential check passes too. We only
      // need an id the photo can point at; vehicle covers most, the others get a row in their table.
      const entityId = `${entityType}-1`;
      const vehicle = coerceRow(buildRow(vehicles, { userId: 'u1', id: 'veh-anchor' }), vehicles);
      backup.vehicles = [vehicle];

      switch (entityType) {
        case 'vehicle':
          backup.vehicles = [
            coerceRow(buildRow(vehicles, { userId: 'u1', id: entityId }), vehicles),
          ];
          break;
        case 'expense':
          backup.expenses = [
            { id: entityId, vehicleId: 'veh-anchor', userId: 'u1' } as Record<string, unknown>,
          ];
          break;
        case 'insurance_policy':
          backup.insurance = [{ id: entityId } as Record<string, unknown>];
          break;
        case 'insurance_claim':
          backup.insurance = [{ id: 'pol-anchor' } as Record<string, unknown>];
          backup.insuranceClaims = [
            { id: entityId, policyId: 'pol-anchor' } as Record<string, unknown>,
          ];
          break;
        case 'odometer_entry':
          backup.odometer = [{ id: entityId, vehicleId: 'veh-anchor' } as Record<string, unknown>];
          break;
        default:
          throw new Error(
            `Unhandled photo entity type in guard: ${entityType} — add a seed branch`
          );
      }

      backup.photos = [coerceRow(buildRow(photos, { userId: 'u1', entityType, entityId }), photos)];

      const result = backupService.validateBackupData(backup);
      const unknownTypeErr = result.errors.filter((e) => e.includes('unknown entity type'));
      expect(
        unknownTypeErr,
        `restore validator does NOT recognize photo entityType "${entityType}" — it is in ENTITY_TO_CATEGORY (upload/provider allowlist) but missing from validatePhotoRefs' entityTypeToIds map in sync/backup.ts. A real backup with this photo type would abort the WHOLE restore (the C404 NORTH_STAR #1 failure). Add "${entityType}" to that map.`
      ).toEqual([]);
    });
  }

  // A photo entityType OUTSIDE the canonical set must still be rejected (the guard isn't over-broad —
  // it pins the SET, both directions).
  test('restore validator rejects a photo entityType NOT in the canonical set', () => {
    const backup = emptyBackup('u1');
    backup.photos = [
      coerceRow(
        buildRow(photos, { userId: 'u1', entityType: 'not_a_real_type', entityId: 'x' }),
        photos
      ),
    ];
    const result = backupService.validateBackupData(backup);
    expect(result.errors.some((e) => e.includes('unknown entity type'))).toBe(true);
  });

  // --- 2. The UPLOAD gate must accept exactly the canonical set ----------------------------------
  // validateEntityOwnership throws ValidationError('Unknown entity type: ...') for a type it doesn't
  // handle. For a recognized type it instead reaches the ownership lookup (which throws NotFoundError
  // for our non-existent id) — so "recognized" == "does NOT throw the unknown-type ValidationError".
  describe('upload gate (validateEntityOwnership) recognizes exactly the canonical set', () => {
    let ctx: TestApp;
    beforeEach(async () => {
      ctx = await createTestApp();
    });
    afterEach(() => ctx.close());

    for (const entityType of PHOTO_ENTITY_TYPES) {
      test(`upload gate recognizes "${entityType}"`, async () => {
        let msg = '';
        try {
          await validateEntityOwnership(entityType, 'no-such-id', ctx.user.id);
        } catch (err) {
          msg = err instanceof Error ? err.message : String(err);
        }
        // It WILL throw (the id doesn't exist) — but NOT the unknown-type error. If it does, the upload
        // gate is missing a type the provider/backup allowlist has → drift.
        expect(
          msg.includes('Unknown entity type'),
          `upload gate validateEntityOwnership does NOT recognize "${entityType}" though it is in ENTITY_TO_CATEGORY — add a case in photos/helpers.ts`
        ).toBe(false);
      });
    }

    test('upload gate rejects a type NOT in the canonical set (Unknown entity type)', async () => {
      let msg = '';
      try {
        await validateEntityOwnership('not_a_real_type', 'x', ctx.user.id);
      } catch (err) {
        msg = err instanceof Error ? err.message : String(err);
      }
      expect(msg.includes('Unknown entity type')).toBe(true);
    });
  });
});
