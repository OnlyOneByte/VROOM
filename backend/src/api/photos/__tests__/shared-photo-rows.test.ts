import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { type Members, seedCar, seedMembers } from '../../../test-helpers/members';

let ctx: TestApp;
let m: Members;
const CAR = 'spr-car';
let listPaths: string[];

async function photo(id: string, entityType: string, entityId: string, createdBy: string | null) {
  await ctx.sql.run(
    "INSERT INTO photos (id, user_id, entity_type, entity_id, file_name, mime_type, file_size, created_by) VALUES (?, ?, ?, ?, 'a.jpg', 'image/jpeg', 10, ?)",
    [id, ctx.user.id, entityType, entityId, createdBy]
  );
}

beforeEach(async () => {
  ctx = await createTestApp();
  await seedCar(ctx, CAR);
  m = await seedMembers(ctx, CAR, 'spr');
  await ctx.sql.run(
    "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('spr-exp', ?, ?, 'fuel', 1717200000, 100)",
    [CAR, ctx.user.id]
  );
  await ctx.sql.run(
    "INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at) VALUES ('spr-odo', ?, ?, 10, 1717200000)",
    [CAR, ctx.user.id]
  );
  const policy = await ctx.authed('POST', '/api/v1/insurance', {
    company: 'Acme',
    terms: [
      { startDate: '2026-01-01', endDate: '2026-12-31', vehicleCoverage: { vehicleIds: [CAR] } },
    ],
  });
  const policyId = (await json<DataEnvelope<{ id: string }>>(policy)).data.id;
  const claim = await ctx.authed('POST', `/api/v1/insurance/${policyId}/claims`, {
    claimDate: '2026-03-01',
    claimType: 'collision',
    vehicleId: CAR,
  });
  const claimId = (await json<DataEnvelope<{ id: string }>>(claim)).data.id;

  const entities: [string, string][] = [
    ['vehicle', CAR],
    ['expense', 'spr-exp'],
    ['odometer_entry', 'spr-odo'],
    ['insurance_policy', policyId],
    ['insurance_claim', claimId],
  ];
  for (const [type, id] of entities) {
    await photo(`${type}-owner`, type, id, null);
    await photo(`${type}-editor`, type, id, m.editor.id);
  }
  listPaths = [
    `/api/v1/vehicles/${CAR}/photos`,
    ...entities.map(([type, id]) => `/api/v1/photos/${type}/${id}`),
  ];
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function listed(request: RequestFn, path: string) {
  const res = await request('GET', path);
  return {
    status: res.status,
    rows: res.status === 200 ? (await json<DataEnvelope<Record<string, unknown>[]>>(res)).data : [],
  };
}

describe('photo rows on a shared car', () => {
  test('reach every member without user id fields, on every photo type', async () => {
    for (const member of [m.viewer, m.editor, m.coOwner]) {
      for (const path of listPaths) {
        const { rows } = await listed(member.request, path);
        for (const row of rows) {
          expect('userId' in row || 'createdBy' in row, `${path} ${row['id']}`).toBe(false);
        }
      }
    }
  });

  test('a co-owner can read every list, so the check above saw rows of each type', async () => {
    for (const path of listPaths) {
      const { status, rows } = await listed(m.coOwner.request, path);
      expect(status, path).toBe(200);
      expect(rows.length, path).toBe(2);
    }
  });

  test('the cover response reaches a member without them too', async () => {
    const res = await m.coOwner.request(
      'PUT',
      `/api/v1/vehicles/${CAR}/photos/vehicle-owner/cover`
    );
    expect(res.status).toBe(200);
    const row = (await json<DataEnvelope<Record<string, unknown>>>(res)).data;
    expect('userId' in row || 'createdBy' in row).toBe(false);
  });

  test('the owner still gets them', async () => {
    for (const path of listPaths) {
      const { rows } = await listed(ctx.authed, path);
      const editors = rows.find((row) => String(row['id']).endsWith('-editor'));
      expect(editors?.['userId'], path).toBe(ctx.user.id);
      expect(editors?.['createdBy'], path).toBe(m.editor.id);
    }
  });
});
