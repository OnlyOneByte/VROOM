/**
 * TRUE backup → restore round-trip for insurance claims, through the REAL stack.
 *
 * insurance_claims was threaded through the backup/restore pipeline by hand
 * across many files (config maps, backup query + referential-integrity, restore
 * FK-ordered insert + ImportSummary, sheets service). Existing tests cover
 * validation / ref-integrity (backup.test) and MOCKED orchestration
 * (unified-restore) — but nothing proved a real export → import preserves a
 * claim. This does: seed a vehicle + policy + fully-populated claim via the real
 * API, exportAsZip (real CSV serialize), wipe + restoreFromBackup (real CSV
 * parse + FK-ordered insert), then read the claim row back and assert its fields.
 *
 * createTestApp() rewrites process.env then dynamic-imports DB-bound modules, so
 * keep this file's imports to the harness + bun:test; import backup/restore
 * dynamically AFTER createTestApp so they bind to the throwaway DB.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

async function seedPolicy(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme Mutual',
    terms: [
      {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        vehicleCoverage: { vehicleIds: [vehicleId] },
      },
    ],
  });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.id;
}

interface ClaimRowDb {
  id: string;
  policy_id: string;
  vehicle_id: string | null;
  claim_type: string;
  status: string;
  payout_amount: number | null;
  fault_designation: string | null;
  description: string | null;
}

function claimRows(): ClaimRowDb[] {
  return ctx.sqlite.query('SELECT * FROM insurance_claims').all() as ClaimRowDb[];
}

describe('backup → restore round-trip preserves insurance claims', () => {
  test('a filed claim survives export + restore with its fields intact', async () => {
    const vehicleId = await seedVehicle();
    const policyId = await seedPolicy(vehicleId);

    // File a fully-populated claim via the real route.
    const created = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'collision',
      status: 'settled',
      payoutAmount: 1234.56,
      faultDesignation: 'not_at_fault',
      description: 'Rear-ended at a light',
      vehicleId,
    });
    const createdBody = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    const claimId = createdBody.data.id;
    expect(claimRows()).toHaveLength(1);

    // Real export → real restore (replace) against the same DB. Import the
    // singletons dynamically so they bind to the harness DB.
    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.insuranceClaims, 'restore summary counts the claim').toBe(1);

    // The claim row survived with its identity + every field intact.
    const rows = claimRows();
    expect(rows, 'exactly one claim after restore (no dup, no loss)').toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(claimId);
    expect(row.policy_id).toBe(policyId);
    expect(row.vehicle_id).toBe(vehicleId);
    expect(row.claim_type).toBe('collision');
    expect(row.status).toBe('settled');
    expect(row.payout_amount).toBe(1234.56);
    expect(row.fault_designation).toBe('not_at_fault');
    expect(row.description).toBe('Rear-ended at a light');
  });

  // C404 (bug, NORTH_STAR #1 crown jewel): a photo attached to an insurance CLAIM must survive the
  // round-trip. insurance_claim is a real photo-upload target (photos/helpers.ts validateEntityOwnership
  // accepts it; the ClaimsSection UI uploads to it), but validateReferentialIntegrity's photo entity-type
  // map omitted it — so a backup carrying a claim photo failed validation with "unknown entity type:
  // insurance_claim" → valid:false → the WHOLE restore aborted (the user couldn't recover ANY data from
  // their own valid backup). The original 15-table cert (C366) predated claim photos. Pre-fix this test
  // throws on restore; post-fix the claim photo round-trips. Seed the photos row directly (the upload
  // route is multipart; the bug is purely in the validator, not the upload path).
  test('a photo attached to an insurance claim survives the round-trip (does not abort restore) — #C404', async () => {
    const vehicleId = await seedVehicle();
    const policyId = await seedPolicy(vehicleId);

    const created = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'collision',
    });
    const createdBody = await json<DataEnvelope<{ id: string }>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    const claimId = createdBody.data.id;

    // A photo attached to that claim (entity_type='insurance_claim'), as an upload would create.
    ctx.sqlite.run(
      `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
       VALUES ('photo-claim-1', ?, 'insurance_claim', ?, 'damage.jpg', 'image/jpeg', 2048)`,
      [ctx.user.id, claimId]
    );

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    // Pre-fix: this throws SyncError(VALIDATION_ERROR) — "unknown entity type: insurance_claim".
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // The claim photo round-tripped intact, still pointing at its claim.
    const photoRows = ctx.sqlite
      .query("SELECT id, entity_type, entity_id FROM photos WHERE entity_type = 'insurance_claim'")
      .all() as { id: string; entity_type: string; entity_id: string }[];
    expect(photoRows, 'the claim photo survived restore').toHaveLength(1);
    expect(photoRows[0].id).toBe('photo-claim-1');
    expect(photoRows[0].entity_id).toBe(claimId);
  });

  test('multiple claims on a policy all survive the round-trip', async () => {
    const vehicleId = await seedVehicle();
    const policyId = await seedPolicy(vehicleId);

    for (const t of ['collision', 'theft', 'weather']) {
      const r = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
        claimDate: '2024-06-15T00:00:00.000Z',
        claimType: t,
      });
      expect(r.status, await r.text()).toBe(201);
    }
    expect(claimRows()).toHaveLength(3);

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');
    const zip = await backupService.exportAsZip(ctx.user.id);
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');

    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.imported?.insuranceClaims).toBe(3);
    expect(claimRows()).toHaveLength(3);
    expect(
      claimRows()
        .map((r) => r.claim_type)
        .sort()
    ).toEqual(['collision', 'theft', 'weather']);
  });
});

// ---------------------------------------------------------------------------
// C407 (guard, NORTH_STAR #1 + #5): DRIFT-GUARD for the #C404 class. A photo's entity_type must round-trip
// for EVERY type the upload path accepts. The upload allowlist (photos/helpers.ts validateEntityOwnership:
// vehicle / insurance_policy / insurance_claim / expense / odometer_entry) and the restore validator's
// entityTypeToIds map (backup.ts validatePhotoRefs) are SEPARATE lists in separate files with no shared
// source of truth — exactly why insurance_claim drifted out of the validator and broke restore (#C404,
// the original 15-table cert predated claim photos). The C404 fix added a per-type round-trip for ONE
// type; a generic "a photo round-trips" test would NOT catch a per-type omission (that's how #C404 slipped
// past C366). This pins ALL FIVE: drop any type from the validator map → that photo restores as "unknown
// entity type" → validateBackupData false → the WHOLE restore aborts → this test goes RED. When a 6th
// photo target is added to the upload path, this test fails until the validator map (and this list) learn it.
// ---------------------------------------------------------------------------
describe('a photo on EVERY upload-accepted entity type survives backup→restore (#C404 drift-guard)', () => {
  test('vehicle / insurance_policy / insurance_claim / expense / odometer_entry photos all round-trip', async () => {
    const vehicleId = await seedVehicle();
    const policyId = await seedPolicy(vehicleId);

    // insurance_claim id
    const claimRes = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
      claimDate: '2024-06-15T00:00:00.000Z',
      claimType: 'collision',
    });
    const claimBody = await json<DataEnvelope<{ id: string }>>(claimRes);
    expect(claimRes.status, JSON.stringify(claimBody)).toBe(201);
    const claimId = claimBody.data.id;

    // expense id
    const expRes = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-06-01T00:00:00.000Z',
    });
    const expBody = await json<DataEnvelope<{ id: string }>>(expRes);
    expect(expRes.status, JSON.stringify(expBody)).toBe(201);
    const expenseId = expBody.data.id;

    // odometer_entry id
    const odoRes = await ctx.authed('POST', `/api/v1/odometer/${vehicleId}`, {
      odometer: 12345,
      recordedAt: '2024-06-01T00:00:00.000Z',
    });
    const odoBody = await json<DataEnvelope<{ id: string }>>(odoRes);
    expect(odoRes.status, JSON.stringify(odoBody)).toBe(201);
    const odometerId = odoBody.data.id;

    // One photo per upload-accepted entity type (the bug is in the validator, not the upload path, so
    // seed the rows directly — same approach as the single-claim case above).
    const targets: [entityType: string, entityId: string][] = [
      ['vehicle', vehicleId],
      ['insurance_policy', policyId],
      ['insurance_claim', claimId],
      ['expense', expenseId],
      ['odometer_entry', odometerId],
    ];
    for (const [i, [entityType, entityId]] of targets.entries()) {
      ctx.sqlite.run(
        `INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size)
         VALUES (?, ?, ?, ?, ?, 'image/jpeg', 1024)`,
        [`photo-${i}`, ctx.user.id, entityType, entityId, `pic-${i}.jpg`]
      );
    }

    const { backupService } = await import('../backup');
    const { restoreService } = await import('../restore');

    const zip = await backupService.exportAsZip(ctx.user.id);
    // RED if any upload-accepted type is missing from the validator's entityTypeToIds map (#C404).
    const result = await restoreService.restoreFromBackup(ctx.user.id, zip, 'replace');
    expect(result.success, JSON.stringify(result)).toBe(true);

    // All five photos survived, each still pointing at its entity.
    const rows = ctx.sqlite
      .query('SELECT entity_type, entity_id FROM photos ORDER BY id')
      .all() as { entity_type: string; entity_id: string }[];
    expect(rows).toHaveLength(5);
    const byType = new Map(rows.map((r) => [r.entity_type, r.entity_id]));
    expect(byType.get('vehicle')).toBe(vehicleId);
    expect(byType.get('insurance_policy')).toBe(policyId);
    expect(byType.get('insurance_claim')).toBe(claimId);
    expect(byType.get('expense')).toBe(expenseId);
    expect(byType.get('odometer_entry')).toBe(odometerId);
  });
});
