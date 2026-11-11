import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type RequestFn,
  type TestApp,
} from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;
let asB: RequestFn;
let bId: string;
let bEmail: string;

beforeEach(async () => {
  ctx = await createTestApp();
  const b = await createInvitee(ctx, 'expw-invitee', 'Editor B');
  bId = b.id;
  bEmail = b.email;
  asB = b.request;
});
afterEach(() => ctx.close());

interface ExpenseRow {
  id: string;
  vehicleId: string;
  expenseAmount: number;
  description: string | null;
}

async function shareAccepted(level: 'viewer' | 'editor'): Promise<string> {
  const vehicleId = await seedVehicle(ctx, { make: 'Shared', model: 'Car', year: 2021 });
  const invite = await ctx.authed('POST', '/api/v1/shares', { vehicleId, email: bEmail, level });
  const inviteBody = await json<DataEnvelope<{ id: string }>>(invite);
  expect(invite.status, JSON.stringify(inviteBody)).toBe(201);
  const acc = await asB('POST', `/api/v1/shares/${inviteBody.data.id}/accept`);
  expect(acc.status, 'B accepts the invite').toBe(200);
  return vehicleId;
}

function storedRow(expenseId: string): { user_id: string; created_by: string | null } {
  return ctx.sqlite
    .query('SELECT user_id, created_by FROM expenses WHERE id = ?')
    .get(expenseId) as { user_id: string; created_by: string | null };
}

describe('shared expense writes stamp the owner and createdBy', () => {
  test('an EDITOR create stamps userId=OWNER and createdBy=editor (rides the owner books)', async () => {
    const vehicleId = await shareAccepted('editor');

    const res = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'maintenance',
      expenseAmount: 50,
      date: '2024-06-01T00:00:00.000Z',
      description: 'oil change by editor',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBe(bId);

    const ownerList = await json<DataEnvelope<ExpenseRow[]>>(
      await ctx.authed('GET', `/api/v1/expenses?vehicleId=${vehicleId}`)
    );
    expect(ownerList.data.find((e) => e.id === body.data.id)).toBeDefined();
  });

  test('an OWNER create on their own vehicle is unchanged: userId=self, createdBy=NULL (self sentinel)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 12,
      date: '2024-06-02T00:00:00.000Z',
    });
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);

    const row = storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBeNull();
  });

  test('a forged createdBy in the OWNER create body is IGNORED (stays NULL, not the forged id)', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Owned', model: 'Car', year: 2022 });
    const res = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 9,
      date: '2024-06-08T00:00:00.000Z',
      createdBy: 'forged-author-id',
    } as Record<string, unknown>);
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const row = storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBeNull();
  });

  test('a forged createdBy in an EDITOR create body is IGNORED (stamped the acting editor, not the forged id)', async () => {
    const vehicleId = await shareAccepted('editor');
    const res = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 9,
      date: '2024-06-09T00:00:00.000Z',
      createdBy: 'forged-author-id',
    } as Record<string, unknown>);
    const body = await json<DataEnvelope<{ id: string }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const row = storedRow(body.data.id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(row.created_by).toBe(bId);
  });

  test('an editor can PUT and DELETE a cost row on the shared vehicle', async () => {
    const vehicleId = await shareAccepted('editor');
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 30,
      date: '2024-06-03T00:00:00.000Z',
    });
    const id = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const put = await asB('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 99 });
    const putBody = await json<DataEnvelope<{ expenseAmount: number }>>(put);
    expect(put.status, JSON.stringify(putBody)).toBe(200);
    expect(putBody.data.expenseAmount).toBe(99);
    expect(storedRow(id).user_id).toBe(ctx.user.id);

    const del = await asB('DELETE', `/api/v1/expenses/${id}`);
    expect(del.status, 'editor can delete a shared-vehicle expense').toBe(200);
    expect(ctx.sqlite.query('SELECT id FROM expenses WHERE id = ?').get(id)).toBeNull();
  });

  test('a VIEWER cannot create/update/delete on the shared vehicle (404, never 403)', async () => {
    const vehicleId = await shareAccepted('viewer');
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 20,
      date: '2024-06-04T00:00:00.000Z',
    });
    const id = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const create = await asB('POST', '/api/v1/expenses', {
      vehicleId,
      category: 'misc',
      expenseAmount: 5,
      date: '2024-06-05T00:00:00.000Z',
    });
    expect(create.status, 'viewer create denied').toBe(404);
    const put = await asB('PUT', `/api/v1/expenses/${id}`, { expenseAmount: 1 });
    expect(put.status, 'viewer update denied').toBe(404);
    const del = await asB('DELETE', `/api/v1/expenses/${id}`);
    expect(del.status, 'viewer delete denied').toBe(404);

    expect((storedRow(id) as { user_id: string }).user_id).toBe(ctx.user.id);
    const stillAmount = ctx.sqlite
      .query('SELECT expense_amount FROM expenses WHERE id = ?')
      .get(id) as { expense_amount: number };
    expect(stillAmount.expense_amount).toBe(2000);
  });

  test('an editor cannot reassign a shared expense onto a vehicle owned by a DIFFERENT user', async () => {
    const sharedVehicle = await shareAccepted('editor');
    const bVehicle = (
      await json<DataEnvelope<{ id: string }>>(
        await asB('POST', '/api/v1/vehicles', { make: 'Bcar', model: 'X', year: 2020 })
      )
    ).data.id;
    const created = await ctx.authed('POST', '/api/v1/expenses', {
      vehicleId: sharedVehicle,
      category: 'misc',
      expenseAmount: 10,
      date: '2024-06-06T00:00:00.000Z',
    });
    const id = (await json<DataEnvelope<{ id: string }>>(created)).data.id;

    const move = await asB('PUT', `/api/v1/expenses/${id}`, { vehicleId: bVehicle });
    expect(move.status, 'cross-owner reassignment rejected').toBeGreaterThanOrEqual(400);
    expect(move.status).toBeLessThan(500);
    const row = storedRow(id);
    expect(row.user_id).toBe(ctx.user.id);
    expect(
      (
        ctx.sqlite.query('SELECT vehicle_id FROM expenses WHERE id = ?').get(id) as {
          vehicle_id: string;
        }
      ).vehicle_id
    ).toBe(sharedVehicle);
  });
});
